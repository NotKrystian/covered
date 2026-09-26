import Foundation

/// DEBUG-only launch arguments for UI tests. Compiled out of Release.
enum LaunchFlags {
    static var bypassAuth: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-CoveredUITestBypassAuth")
        #else
        false
        #endif
    }

    static var freshSession: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-CoveredUITestFresh")
        #else
        false
        #endif
    }

    static var seededSearchQuery: String? {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-CoveredUITestSearch")
            ? "black fleece jacket medium"
            : nil
        #else
        nil
        #endif
    }

    static func applyLaunchResetIfNeeded() {
        #if DEBUG
        guard freshSession else { return }
        UserDefaults.standard.set(false, forKey: AppState.onboardedDefaultsKey)
        if let cookies = HTTPCookieStorage.shared.cookies {
            for cookie in cookies {
                HTTPCookieStorage.shared.deleteCookie(cookie)
            }
        }
        KeychainToken.clear()
        #endif
    }
}
