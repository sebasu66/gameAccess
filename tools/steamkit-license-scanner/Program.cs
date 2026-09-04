using System.Text.Json;
using SteamKit2;
using SteamKit2.Authentication;

namespace GameAccess.SteamKitLicenseScanner;

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

internal sealed record PackageResult(
    uint package_id,
    uint owner_account_id,
    string license_type,
    bool borrowed,
    bool non_permanent,
    bool preferred_owner,
    int minute_limit,
    int minutes_used,
    IReadOnlyList<uint> app_ids
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

        var timeoutSeconds = 45;
        if (int.TryParse(Environment.GetEnvironmentVariable("GA_STEAM_TIMEOUT_SECONDS"), out var configuredTimeout))
        {
            timeoutSeconds = Math.Clamp(configuredTimeout, 10, 180);
        }

        var steamClient = new SteamClient();
        var manager = new CallbackManager(steamClient);
        var steamUser = steamClient.GetHandler<SteamUser>() ?? throw new InvalidOperationException("SteamUser handler unavailable");
        var steamApps = steamClient.GetHandler<SteamApps>() ?? throw new InvalidOperationException("SteamApps handler unavailable");

        var connected = NewTcs<SteamClient.ConnectedCallback>();
        var loggedOn = NewTcs<SteamUser.LoggedOnCallback>();
        var licensesReceived = NewTcs<SteamApps.LicenseListCallback>();
        var disconnected = NewTcs<SteamClient.DisconnectedCallback>();

        manager.Subscribe<SteamClient.ConnectedCallback>(callback => connected.TrySetResult(callback));
        manager.Subscribe<SteamClient.DisconnectedCallback>(callback => disconnected.TrySetResult(callback));
        manager.Subscribe<SteamUser.LoggedOnCallback>(callback => loggedOn.TrySetResult(callback));
        manager.Subscribe<SteamApps.LicenseListCallback>(callback => licensesReceived.TrySetResult(callback));

        using var pumpCts = new CancellationTokenSource();
        var pumpTask = Task.Run(() =>
        {
            while (!pumpCts.IsCancellationRequested)
            {
                manager.RunWaitCallbacks(TimeSpan.FromMilliseconds(250));
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

            _ = steamUser.LogOn(new SteamUser.LogOnDetails
            {
                Username = pollResponse.AccountName,
                AccessToken = pollResponse.RefreshToken,
                ShouldRememberPassword = false,
            });

            var logon = await loggedOn.Task.WaitAsync(operationToken);
            if (logon.Result != EResult.OK)
            {
                Write(new
                {
                    status = "logon_error",
                    result = logon.Result.ToString(),
                    extended_result = logon.ExtendedResult.ToString(),
                });
                return 5;
            }

            var licenseCallback = await licensesReceived.Task.WaitAsync(operationToken);
            if (licenseCallback.Result != EResult.OK)
            {
                Write(new { status = "license_error", result = licenseCallback.Result.ToString() });
                return 6;
            }

            var licenses = licenseCallback.LicenseList
                .Where(license => license.PackageID > 0)
                .GroupBy(license => license.PackageID)
                .Select(group => group.First())
                .ToArray();

            var packageApps = new Dictionary<uint, SortedSet<uint>>();
            var resolvedPackages = new HashSet<uint>();
            var unknownPackages = new HashSet<uint>();

            const int batchSize = 100;
            for (var offset = 0; offset < licenses.Length; offset += batchSize)
            {
                operationToken.ThrowIfCancellationRequested();
                var batch = licenses
                    .Skip(offset)
                    .Take(batchSize)
                    .Select(license => new SteamApps.PICSRequest(license.PackageID, license.AccessToken))
                    .ToArray();

                AsyncJobMultiple<SteamApps.PICSProductInfoCallback>.ResultSet resultSet;
                try
                {
                    resultSet = await steamApps.PICSGetProductInfo(
                        Array.Empty<SteamApps.PICSRequest>(),
                        batch,
                        metaDataOnly: false
                    );
                }
                catch (Exception) when (!operationToken.IsCancellationRequested)
                {
                    // Keep the successfully resolved batches. Missing package IDs are
                    // reported below so the caller can mark the inventory partial.
                    continue;
                }

                foreach (var callback in resultSet.Results)
                {
                    foreach (var packageId in callback.UnknownPackages)
                    {
                        unknownPackages.Add(packageId);
                    }
                    foreach (var pair in callback.Packages)
                    {
                        var packageId = pair.Key;
                        resolvedPackages.Add(packageId);
                        var appIds = new SortedSet<uint>();
                        var appIdNode = pair.Value.KeyValues["appids"];
                        foreach (var child in appIdNode.Children)
                        {
                            var appId = child.AsUnsignedInteger();
                            if (appId > 0)
                            {
                                appIds.Add(appId);
                            }
                        }
                        packageApps[packageId] = appIds;
                    }
                }
            }

            var packageResults = licenses
                .Select(license => new PackageResult(
                    package_id: license.PackageID,
                    owner_account_id: license.OwnerAccountID,
                    license_type: license.LicenseType.ToString(),
                    borrowed: license.LicenseFlags.HasFlag(ELicenseFlags.Borrowed),
                    non_permanent: license.LicenseFlags.HasFlag(ELicenseFlags.NonPermanent),
                    preferred_owner: license.LicenseFlags.HasFlag(ELicenseFlags.PreferredOwner),
                    minute_limit: license.MinuteLimit,
                    minutes_used: license.MinutesUsed,
                    app_ids: packageApps.TryGetValue(license.PackageID, out var apps)
                        ? apps.ToArray()
                        : Array.Empty<uint>()
                ))
                .ToArray();

            var missingPackageInfo = licenses
                .Select(license => license.PackageID)
                .Where(packageId => !resolvedPackages.Contains(packageId) && !unknownPackages.Contains(packageId))
                .Distinct()
                .OrderBy(packageId => packageId)
                .ToArray();

            Write(new
            {
                status = "ok",
                license_count = packageResults.Length,
                package_info_resolved_count = resolvedPackages.Count,
                borrowed_package_count = packageResults.Count(item => item.borrowed),
                non_permanent_package_count = packageResults.Count(item => item.non_permanent),
                preferred_owner_package_count = packageResults.Count(item => item.preferred_owner),
                distinct_owner_account_ids = packageResults.Select(item => item.owner_account_id).Where(id => id > 0).Distinct().Order().ToArray(),
                unknown_package_ids = unknownPackages.Order().ToArray(),
                missing_package_info = missingPackageInfo,
                complete = missingPackageInfo.Length == 0,
                packages = packageResults,
            });
            return missingPackageInfo.Length == 0 ? 0 : 7;
        }
        catch (OperationCanceledException)
        {
            Write(new { status = "timeout", timeout_seconds = timeoutSeconds });
            return 8;
        }
        catch (GuardRequiredException guard)
        {
            Write(new { status = "guard_required", guard_method = guard.Method });
            return 3;
        }
        catch (Exception error)
        {
            Write(new { status = "error", error = $"{error.GetType().Name}: {error.Message}" });
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

    private static TaskCompletionSource<T> NewTcs<T>() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static void Write(object value) =>
        Console.Out.WriteLine(JsonSerializer.Serialize(value, JsonOptions));
}
