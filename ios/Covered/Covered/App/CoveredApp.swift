import SwiftUI

@main
struct CoveredApp: App {
    init() {
        LaunchFlags.applyLaunchResetIfNeeded()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.light)
                .tint(Color.accent)
        }
    }
}
