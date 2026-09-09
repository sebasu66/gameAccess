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
                    var response = await econ.GetInventoryItemsWithDescriptions(
                        new CEcon_GetInventoryItemsWithDescriptions_Request
                        {
                            appid = context.appid,
                            contextid = context.contextid,
                            steamid = steamId64,
                            count = 5000,
                            get_descriptions = true,
                            get_asset_properties = false,
                            language = "english",
                        }
                    );

                    var body = response.Body;
                    var sample = body.descriptions
                        .Take(25)
                        .Select(description => new
                        {
                            name = Property(description, "name"),
                            market_hash_name = Property(description, "market_hash_name"),
                            marketable = Property(description, "marketable"),
                            tradable = Property(description, "tradable"),
                            type = Property(description, "type"),
                            classid = Property(description, "classid"),
                            instanceid = Property(description, "instanceid"),
                        })
                        .ToArray();

                    results.Add(new
                    {
                        appid = context.appid,
                        contextid = context.contextid,
                        label = context.label,
                        result = response.Result.ToString(),
                        total_inventory_count = body.total_inventory_count,
                        asset_count = body.assets.Count,
                        description_count = body.descriptions.Count,
                        more_items = body.more_items,
                        last_assetid = body.last_assetid,
                        sample,
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

    private static object? Property(object value, string name) =>
        value.GetType().GetProperty(name)?.GetValue(value);

    private static TaskCompletionSource<T> NewTcs<T>() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static void Write(object value) =>
        Console.Out.WriteLine(JsonSerializer.Serialize(value, JsonOptions));
}
