"""Read NVIDIA driver profile settings (the ones in NVIDIA Control Panel > Manage 3D settings) through NVAPI.

  python tools/benchmark/nvidia_profile.py show Heaven.exe superposition.exe

`show` prints the global value and the per-game profile value of the settings Game Boost would use.
`set_for_app` / `restore_for_app` change one setting in a game's existing driver profile and put the
previous value back (writing needs administrator). Uses nvapi64.dll from the installed driver; IDs
from NVIDIA's MIT-licensed NVAPI SDK headers (NvApiDriverSettings.h, nvapi_interface.h).
"""
from __future__ import annotations

import ctypes
import sys

FUNCTIONS = {"Initialize": 0x0150E828, "CreateSession": 0x0694D52E, "DestroySession": 0xDAD9CFF8,
             "LoadSettings": 0x375DBD6B, "SaveSettings": 0xFCBC7E14, "GetBaseProfile": 0xDA8466A0,
             "GetSetting": 0x73BF8338, "SetSetting": 0x577DD202, "RestoreProfileDefaultSetting": 0x53F0381E,
             "FindApplicationByName": 0xEEE566B2, "GetProfileInfo": 0x61CD6FD6,
             "GetDriverAndBranchVersion": 0x2926AAAD}
SETTINGS = {  # id: (name, {value: label}, driver default)
    0x1057EB71: ("Power management mode", {0: "Adaptive", 1: "Prefer maximum performance", 3: "Prefer consistent performance",
                                           4: "Prefer minimum", 5: "Normal (optimal power)"}, 5),
    0x007BA09E: ("Max pre-rendered frames (Low latency: 1 = On)", {0: "Use the 3D application setting"}, 0),
    0x10835002: ("Max frame rate (0 = off)", {}, 0),
    0x00CE2691: ("Texture filtering quality", {0x00: "High quality", 0x0A: "Quality", 0x14: "Performance", 0x1E: "High performance"}, 0x0A),
    0x20C1221E: ("Threaded optimization (OpenGL)", {0: "Auto", 1: "On", 2: "Off"}, 0),
    0x00A879CF: ("Vertical sync", {0x60925292: "Use the 3D application setting", 0x08416747: "Off", 0x47814940: "On", 0x18888888: "Fast"}, 0x60925292),
    0x00AC8497: ("Shader cache size (MB)", {}, None),
}
NVAPI_SETTING_NOT_FOUND = -160
NVAPI_EXECUTABLE_NOT_FOUND = -166

UnicodeString = ctypes.c_uint16 * 2048


class Value(ctypes.Union):
    _fields_ = [("u32", ctypes.c_uint32), ("binary", ctypes.c_uint8 * 4100), ("text", UnicodeString)]


class Setting(ctypes.Structure):  # NVDRS_SETTING_V1
    _fields_ = [("version", ctypes.c_uint32), ("name", UnicodeString), ("id", ctypes.c_uint32), ("type", ctypes.c_uint32),
                ("location", ctypes.c_uint32), ("isCurrentPredefined", ctypes.c_uint32), ("isPredefinedValid", ctypes.c_uint32),
                ("predefined", Value), ("current", Value)]


class Application(ctypes.Structure):  # NVDRS_APPLICATION_V1
    _fields_ = [("version", ctypes.c_uint32), ("isPredefined", ctypes.c_uint32), ("appName", UnicodeString),
                ("friendlyName", UnicodeString), ("launcher", UnicodeString)]


class Profile(ctypes.Structure):  # NVDRS_PROFILE_V1
    _fields_ = [("version", ctypes.c_uint32), ("name", UnicodeString), ("gpuSupport", ctypes.c_uint32),
                ("isPredefined", ctypes.c_uint32), ("numOfApps", ctypes.c_uint32), ("numOfSettings", ctypes.c_uint32)]


def versioned(struct):
    item = struct()
    item.version = ctypes.sizeof(struct) | (1 << 16)
    return item


def text(value) -> str:
    return "".join(map(chr, value)).split("\0", 1)[0]


class NvApi:
    def __init__(self):
        dll = ctypes.WinDLL("nvapi64.dll")
        query = dll.nvapi_QueryInterface
        query.restype, query.argtypes = ctypes.c_void_p, [ctypes.c_uint32]
        # No argtypes: every call passes ctypes objects, so pointers keep their 64-bit width.
        self.fn = {name: ctypes.CFUNCTYPE(ctypes.c_int)(query(fid)) for name, fid in FUNCTIONS.items()}
        self.check(self.fn["Initialize"](), "Initialize")
        self.session = ctypes.c_void_p()
        self.check(self.fn["CreateSession"](ctypes.byref(self.session)), "CreateSession")
        self.check(self.fn["LoadSettings"](self.session), "LoadSettings")

    @staticmethod
    def check(status: int, what: str) -> None:
        if status != 0:
            raise RuntimeError(f"NvAPI_{what} failed ({status})")

    def driver(self) -> str:
        version, branch = ctypes.c_uint32(), (ctypes.c_char * 64)()
        self.fn["GetDriverAndBranchVersion"](ctypes.byref(version), branch)
        return f"{version.value // 100}.{version.value % 100:02d}"

    def base_profile(self) -> ctypes.c_void_p:
        handle = ctypes.c_void_p()
        self.check(self.fn["GetBaseProfile"](self.session, ctypes.byref(handle)), "GetBaseProfile")
        return handle

    def app_profile(self, exe: str) -> tuple[ctypes.c_void_p | None, str]:
        handle, app = ctypes.c_void_p(), versioned(Application)
        status = self.fn["FindApplicationByName"](self.session, ctypes.c_wchar_p(exe), ctypes.byref(handle), ctypes.byref(app))
        if status == NVAPI_EXECUTABLE_NOT_FOUND:
            return None, ""
        self.check(status, "FindApplicationByName")
        info = versioned(Profile)
        self.check(self.fn["GetProfileInfo"](self.session, handle, ctypes.byref(info)), "GetProfileInfo")
        return handle, text(info.name)

    def get(self, profile, setting_id: int) -> tuple[int | None, bool]:
        """(value, set_by_user) or (None, False) when the profile doesn't define it."""
        setting = versioned(Setting)
        status = self.fn["GetSetting"](self.session, profile, ctypes.c_uint32(setting_id), ctypes.byref(setting))
        if status == NVAPI_SETTING_NOT_FOUND:
            return None, False
        self.check(status, "GetSetting")
        return setting.current.u32, not setting.isCurrentPredefined

    def set(self, profile, setting_id: int, value: int) -> None:
        setting = versioned(Setting)
        setting.id, setting.type, setting.current.u32 = setting_id, 0, value  # NVDRS_DWORD_TYPE
        self.check(self.fn["SetSetting"](self.session, profile, ctypes.byref(setting)), "SetSetting")

    def reset(self, profile, setting_id: int) -> None:
        status = self.fn["RestoreProfileDefaultSetting"](self.session, profile, ctypes.c_uint32(setting_id))
        if status not in (0, NVAPI_SETTING_NOT_FOUND):
            self.check(status, "RestoreProfileDefaultSetting")

    def save(self) -> None:
        self.check(self.fn["SaveSettings"](self.session), "SaveSettings")

    def close(self) -> None:
        self.fn["DestroySession"](self.session)


def set_for_app(exe: str, setting_id: int, value: int) -> dict:
    """Change one setting in the game's driver profile; returns what restore_for_app needs.

    Pass the FULL path of the executable: several profiles can list the same exe name with
    different conditions (e.g. another file in the folder), and only the full path gets the
    profile the driver really applies when the game starts."""
    api = NvApi()
    try:
        profile, name = api.app_profile(exe)
        if profile is None:
            raise RuntimeError(f"{exe} has no NVIDIA driver profile")  # creating profiles is a later step
        old, user = api.get(profile, setting_id)
        api.set(profile, setting_id, value)
        api.save()
        return {"exe": exe, "profile": name, "setting": setting_id, "old": old if user else None}
    finally:
        api.close()


def restore_for_app(change: dict) -> None:
    api = NvApi()
    try:
        profile, _ = api.app_profile(change["exe"])
        if profile is not None:
            if change["old"] is None:
                api.reset(profile, change["setting"])  # back to NVIDIA's predefined value
            else:
                api.set(profile, change["setting"], change["old"])
            api.save()
    finally:
        api.close()


def describe(setting_id: int, value: int | None, user: bool) -> str:
    if value is None:
        return "driver default"
    name, labels, _ = SETTINGS[setting_id]
    return f"{labels.get(value, value)}{' (user)' if user else ''}"


def show(exes: list[str]) -> None:
    api = NvApi()
    try:
        print(f"NVIDIA driver {api.driver()}")
        base = api.base_profile()
        profiles = [("Global", base)] + [(exe, api.app_profile(exe)) for exe in exes]
        for label, entry in profiles[1:]:
            print(f"{label}: {'profile ' + repr(entry[1]) if entry[0] else 'no driver profile (uses Global)'}")
        print(f"\n{'setting':<46}" + "".join(f"{label[:22]:<24}" for label, _ in profiles))
        for setting_id, (name, _, _) in SETTINGS.items():
            row = f"{name[:45]:<46}"
            for label, entry in profiles:
                handle = entry if label == "Global" else entry[0]
                row += f"{(describe(setting_id, *api.get(handle, setting_id)) if handle else 'Global')[:22]:<24}"
            print(row)
    finally:
        api.close()


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] != "show":
        sys.exit(__doc__)
    show(sys.argv[2:])
