use std::{env, fs, io, path::PathBuf};

fn activation_dir() -> Result<PathBuf, String> {
    let base = env::var_os("LOCALAPPDATA").ok_or("Windows application data is unavailable")?;
    let directory = PathBuf::from(base).join("GameAccess").join("activation");
    fs::create_dir_all(&directory).map_err(|err| format!("Cannot create activation directory: {err}"))?;
    Ok(directory)
}

pub fn installation_id() -> Result<String, String> {
    let path = activation_dir()?.join("installation-id");
    if !path.exists() {
        let candidate = uuid::Uuid::new_v4().to_string();
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                use std::io::Write;
                file.write_all(candidate.as_bytes())
                    .map_err(|err| format!("Cannot save installation identity: {err}"))?;
            }
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {}
            Err(err) => return Err(format!("Cannot create installation identity: {err}")),
        }
    }
    let value = fs::read_to_string(path).map_err(|err| format!("Cannot read installation identity: {err}"))?;
    uuid::Uuid::parse_str(value.trim())
        .map(|id| id.to_string())
        .map_err(|_| "Installation identity is invalid".to_string())
}

#[cfg(windows)]
mod windows_protection {
    use std::{ffi::c_void, ptr, slice};

    #[repr(C)]
    struct DataBlob {
        length: u32,
        data: *mut u8,
    }

    #[link(name = "Crypt32")]
    extern "system" {
        fn CryptProtectData(
            input: *const DataBlob,
            description: *const u16,
            entropy: *const DataBlob,
            reserved: *mut c_void,
            prompt: *const c_void,
            flags: u32,
            output: *mut DataBlob,
        ) -> i32;
        fn CryptUnprotectData(
            input: *const DataBlob,
            description: *mut *mut u16,
            entropy: *const DataBlob,
            reserved: *mut c_void,
            prompt: *const c_void,
            flags: u32,
            output: *mut DataBlob,
        ) -> i32;
    }

    #[link(name = "Kernel32")]
    extern "system" {
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
    }

    fn transform(input: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
        let input_blob = DataBlob { length: input.len() as u32, data: input.as_ptr() as *mut u8 };
        let mut output = DataBlob { length: 0, data: ptr::null_mut() };
        // DPAPI uses the current Windows account and this machine. Never use
        // CRYPTPROTECT_LOCAL_MACHINE, which would let other accounts decrypt it.
        let success = unsafe {
            if encrypt {
                CryptProtectData(&input_blob, ptr::null(), ptr::null(), ptr::null_mut(), ptr::null(), 1, &mut output)
            } else {
                CryptUnprotectData(&input_blob, ptr::null_mut(), ptr::null(), ptr::null_mut(), ptr::null(), 1, &mut output)
            }
        };
        if success == 0 {
            return Err("Windows could not protect the activation session".to_string());
        }
        let bytes = unsafe { slice::from_raw_parts(output.data, output.length as usize).to_vec() };
        unsafe { LocalFree(output.data.cast()); }
        Ok(bytes)
    }

    pub fn protect(value: &[u8]) -> Result<Vec<u8>, String> { transform(value, true) }
    pub fn unprotect(value: &[u8]) -> Result<Vec<u8>, String> { transform(value, false) }
}

pub fn read_session() -> Result<Option<String>, String> {
    let path = activation_dir()?.join("session.dpapi");
    let encrypted = match fs::read(path) {
        Ok(data) => data,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("Cannot read activation session: {err}")),
    };
    #[cfg(windows)]
    {
        let decrypted = windows_protection::unprotect(&encrypted)?;
        String::from_utf8(decrypted)
            .map(Some)
            .map_err(|_| "Activation session is damaged".to_string())
    }
    #[cfg(not(windows))]
    { let _ = encrypted; Err("Activation storage requires Windows".to_string()) }
}

pub fn save_session(token: &str) -> Result<(), String> {
    if token.len() < 20 || token.len() > 200 {
        return Err("Invalid activation session".to_string());
    }
    #[cfg(windows)]
    {
        let encrypted = windows_protection::protect(token.as_bytes())?;
        fs::write(activation_dir()?.join("session.dpapi"), encrypted)
            .map_err(|err| format!("Cannot save activation session: {err}"))
    }
    #[cfg(not(windows))]
    { Err("Activation storage requires Windows".to_string()) }
}

pub fn clear_session() -> Result<(), String> {
    match fs::remove_file(activation_dir()?.join("session.dpapi")) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("Cannot clear activation session: {err}")),
    }
}

