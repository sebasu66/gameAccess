using System.Text.Json;
using SteamKit2;
using SteamKit2.Authentication;
using SteamKit2.Internal;

namespace GameAccess.SteamKitInventoryScanner;

internal sealed class GuardRequiredException(string method) : Exception(method)
{
    public string Method { get; } = method;
}

internal sealed class NonInteractiveAuthenticator : IAuthenticator
{
    public Task<string> GetDeviceCodeAsync(bool previousCodeWasIncorrect) =>
        Task.FromException<string>(new GuardRequiredException("device_code"));

    public Task<string> GetEmailCodeAsync(string email, bool previousCodeWasIncorrect) =>
        Task.FromException<string>(new GuardRequiredException("email_code"));

    public Task<bool> AcceptDeviceConfirmationAsync() =>
        Task.FromException<bool>(new GuardRequiredException("device_confirmation"));
}

internal sealed record InventoryContext(uint appid, ulong contextid, string label);
internal sealed record InventoryItemResult(
    uint appid,
    ulong contextid,
    ulong assetid,
    ulong classid,
    ulong instanceid,
    uint amount,
    string name,
    string market_hash_name,
    bool marketable,
    bool tradable,
    string type
);

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = null,
        WriteIndented = false,
    };

    public static async Task<int> Main()
    {
        var username = Environment.GetEnvironmentVariable("GA_STEAM_USER") ?? "";
        var password = Environment.GetEnvironmentVariable("GA_STEAM_PASS") ?? "";
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrEmpty(password))
        {
            Write(new { status = "configuration_error", error = "GA_STEAM_USER and GA_STEAM_PASS are required" });
            return 2;
        }

        var contexts = ParseContexts(Environment.GetEnvironmentVariable("GA_INVENTORY_CONTEXTS"));
        var includeItems = string.Equals(
            Environment.GetEnvironmentVariable("GA_INVENTORY_INCLUDE_ITEMS"),
            "1",
            StringComparison.Ordinal
        );
        var timeoutSeconds = 90;
        if (int.TryParse(Environment.GetEnvironmentVariable("GA_STEAM_TIMEOUT_SECONDS"), out var configuredTimeout))
        {
            timeoutSeconds = Math.Clamp(configuredTimeout, 15, 180);
        }

        uint loginId = 0x4741F001;
        if (uint.TryParse(Environment.GetEnvironmentVariable("GA_STEAM_LOGIN_ID"), out var configuredLoginId) && configuredLoginId != 0)
        {
            loginId = configuredLoginId;
        }

        var steamClient = new SteamClient();
        var manager = new CallbackManager(steamClient);
        var steamUser = steamClient.GetHandler<SteamUser>() ?? throw new InvalidOperationException("SteamUser handler unavailable");
        var unifiedMessages = steamClient.GetHandler<SteamUnifiedMessages>() ?? throw new InvalidOperationException("SteamUnifiedMessages handler unavailable");
        var econ = unifiedMessages.CreateService<Econ>();

        var connected = NewTcs<SteamClient.ConnectedCallback>();
        var loggedOn = NewTcs<SteamUser.LoggedOnCallback>();

        manager.Subscribe<SteamClient.ConnectedCallback>(callback => connected.TrySetResult(callback));
        manager.Subscribe<SteamUser.LoggedOnCallback>(callback => loggedOn.TrySetResult(callback));

        using var pumpCts = new CancellationTokenSource();
        var pumpTask = Task.Run(() =>
        {
            while (!pumpCts.IsCancellationRequested)
            {
                manager.RunWaitCallbacks(TimeSpan.FromMilliseconds(200));
            }
        });

        using var operationCts = new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSeconds));
        var operationToken = operationCts.Token;

        try
        {
            steamClient.Connect();
            await connected.Task.WaitAsync(operationToken);

            AuthPollResult pollResponse;
            try
            {
                var authSession = await steamClient.Authentication.BeginAuthSessionViaCredentialsAsync(
                    new AuthSessionDetails
                    {
                        Username = username,
                        Password = password,
                        IsPersistentSession = false,
                        GuardData = null,
                        Authenticator = new NonInteractiveAuthenticator(),
                    }
                );
                pollResponse = await authSession.PollingWaitForResultAsync();
            }
            catch (GuardRequiredException guard)
            {
                Write(new { status = "guard_required", guard_method = guard.Method });
                return 3;
            }
            catch (AuthenticationException authError)
            {
                Write(new { status = "authentication_error", error = authError.Message });
                return 4;
            }

            steamUser.LogOn(new SteamUser.LogOnDetails
            {
                Username = pollResponse.AccountName,
                AccessToken = pollResponse.RefreshToken,
                ShouldRememberPassword = false,
                LoginID = loginId,
            });

            var logon = await loggedOn.Task.WaitAsync(operationToken);
            if (logon.Result != EResult.OK)
            {
                Write(new
                {
                    status = "logon_error",
                    result = logon.Result.ToString(),
                    extended_result = logon.ExtendedResult.ToString(),
                    login_id = loginId,
                });
                return 5;
            }

            var steamId64 = steamClient.SteamID?.ConvertToUInt64() ?? 0UL;
            if (steamId64 == 0)
            {
                Write(new { status = "steam_id_error", error = "Authenticated session did not expose a SteamID64" });
                return 6;
            }

            var results = new List<object>();
            foreach (var context in contexts)
            {
                operationToken.ThrowIfCancellationRequested();
                try
                {
                    var items = new List<InventoryItemResult>();
                    var descriptionKeys = new HashSet<(ulong classid, ulong instanceid)>();
                    uint totalInventoryCount = 0;
                    ulong startAssetId = 0;
                    ulong previousStartAssetId = ulong.MaxValue;
                    var pageCount = 0;
                    var lastResult = EResult.OK;
                    bool moreItems;

                    do
                    {
                        operationToken.ThrowIfCancellationRequested();
                        var response = await econ.GetInventoryItemsWithDescriptions(
                            new CEcon_GetInventoryItemsWithDescriptions_Request
                            {
                                appid = context.appid,
                                contextid = context.contextid,
                                steamid = steamId64,
                                count = 5000,
                                start_assetid = startAssetId,
                                get_descriptions = true,
                                get_asset_properties = false,
                                language = "english",
                            }
                        );

                        lastResult = response.Result;
                        var body = response.Body;
                        totalInventoryCount = body.total_inventory_count;
                        pageCount += 1;

                        var descriptions = new Dictionary<(ulong classid, ulong instanceid), object>();
                        foreach (var description in body.descriptions)
                        {
                            var classid = UInt64Property(description, "classid");
                            var instanceid = UInt64Property(description, "instanceid");
                            descriptions[(classid, instanceid)] = description;
                            descriptionKeys.Add((classid, instanceid));
                        }

                        foreach (var asset in body.assets)
                        {
                            var classid = UInt64Property(asset, "classid");
                            var instanceid = UInt64Property(asset, "instanceid");
                            descriptions.TryGetValue((classid, instanceid), out var description);
                            items.Add(new InventoryItemResult(
                                appid: context.appid,
                                contextid: context.contextid,
                                assetid: UInt64Property(asset, "assetid"),
                                classid: classid,
                                instanceid: instanceid,
                                amount: Math.Max(1, UInt32Property(asset, "amount")),
                                name: StringProperty(description, "name"),
                                market_hash_name: StringProperty(description, "market_hash_name"),
                                marketable: BoolProperty(description, "marketable"),
                                tradable: BoolProperty(description, "tradable"),
                                type: StringProperty(description, "type")
                            ));
                        }

                        moreItems = body.more_items;
                        if (moreItems)
                        {
                            previousStartAssetId = startAssetId;
                            startAssetId = body.last_assetid;
                            if (startAssetId == 0 || startAssetId == previousStartAssetId)
                            {
                                throw new InvalidOperationException("Steam inventory pagination stalled");
                            }
                        }
                    }
                    while (moreItems);

                    var sample = items
                        .Take(25)
                        .Select(item => new
                        {
                            item.name,
                            item.market_hash_name,
                            item.marketable,
                            item.tradable,
                            item.type,
                            item.classid,
                            item.instanceid,
                        })
                        .ToArray();

                    results.Add(new
                    {
                        appid = context.appid,
                        contextid = context.contextid,
                        label = context.label,
                        result = lastResult.ToString(),
                        total_inventory_count = totalInventoryCount,
                        asset_count = items.Count,
                        description_count = descriptionKeys.Count,
                        page_count = pageCount,
                        more_items = false,
                        last_assetid = 0,
                        sample,
                        items = includeItems ? items : null,
                    });
                }
                catch (Exception error) when (!operationToken.IsCancellationRequested)
                {
                    results.Add(new
                    {
                        appid = context.appid,
                        contextid = context.contextid,
                        label = context.label,
                        result = "exception",
                        error = $"{error.GetType().Name}: {error.Message}",
                    });
                }
            }

            Write(new
            {
                status = "ok",
                account_name = pollResponse.AccountName,
                steam_id64 = steamId64,
                contexts = results,
            });
            return 0;
        }
        catch (OperationCanceledException)
        {
            Write(new { status = "timeout", timeout_seconds = timeoutSeconds, login_id = loginId });
            return 8;
        }
        catch (Exception error)
        {
            Write(new { status = "error", error = $"{error.GetType().Name}: {error.Message}", login_id = loginId });
            return 9;
        }
        finally
        {
            try { steamUser.LogOff(); } catch { }
            try { steamClient.Disconnect(); } catch { }
            pumpCts.Cancel();
            try { await pumpTask.WaitAsync(TimeSpan.FromSeconds(2)); } catch { }
        }
    }

    private static IReadOnlyList<InventoryContext> ParseContexts(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new[]
            {
                new InventoryContext(753, 6, "Steam Community"),
                new InventoryContext(730, 2, "Counter-Strike 2"),
                new InventoryContext(440, 2, "Team Fortress 2"),
                new InventoryContext(570, 2, "Dota 2"),
            };
        }

        var result = new List<InventoryContext>();
        foreach (var entry in raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var parts = entry.Split(':', 3, StringSplitOptions.TrimEntries);
            if (parts.Length < 2 || !uint.TryParse(parts[0], out var appid) || !ulong.TryParse(parts[1], out var contextid))
            {
                continue;
            }
            var label = parts.Length >= 3 && !string.IsNullOrWhiteSpace(parts[2]) ? parts[2] : $"{appid}:{contextid}";
            result.Add(new InventoryContext(appid, contextid, label));
        }
        return result.Count > 0 ? result : throw new InvalidOperationException("GA_INVENTORY_CONTEXTS did not contain any valid contexts");
    }

    private static object? Property(object? value, string name) =>
        value?.GetType().GetProperty(name)?.GetValue(value);

    private static string StringProperty(object? value, string name) =>
        Convert.ToString(Property(value, name))?.Trim() ?? "";

    private static ulong UInt64Property(object? value, string name)
    {
        try { return Convert.ToUInt64(Property(value, name) ?? 0UL); }
        catch { return 0UL; }
    }

    private static uint UInt32Property(object? value, string name)
    {
        try { return Convert.ToUInt32(Property(value, name) ?? 0U); }
        catch { return 0U; }
    }

    private static bool BoolProperty(object? value, string name)
    {
        var raw = Property(value, name);
        if (raw is bool flag) return flag;
        if (raw is null) return false;
        if (bool.TryParse(Convert.ToString(raw), out var parsed)) return parsed;
        try { return Convert.ToInt64(raw) != 0; }
        catch { return false; }
    }

    private static TaskCompletionSource<T> NewTcs<T>() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static void Write(object value) =>
        Console.Out.WriteLine(JsonSerializer.Serialize(value, JsonOptions));
}
