import SwiftUI

struct RootView: View {
    private let state = AppState.shared

    var body: some View {
        Group {
            if state.onboarded {
                MainTabs()
            } else {
                OnboardingFlow()
            }
        }
        .animation(Motion.soft, value: state.onboarded)
        .task { await state.refresh() }
        .preferredColorScheme(.light)
        .tint(Color.ink)
    }
}

private struct MainTabs: View {
    @Bindable private var tabs = CoveredTabs.shared

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                ShopView()
                    .opacity(tabs.selection == .shop ? 1 : 0)
                    .allowsHitTesting(tabs.selection == .shop)
                OrdersView()
                    .opacity(tabs.selection == .orders ? 1 : 0)
                    .allowsHitTesting(tabs.selection == .orders)
                WalletView()
                    .opacity(tabs.selection == .wallet ? 1 : 0)
                    .allowsHitTesting(tabs.selection == .wallet)
                SettingsView()
                    .opacity(tabs.selection == .settings ? 1 : 0)
                    .allowsHitTesting(tabs.selection == .settings)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            CoveredTabBar(selection: $tabs.selection)
        }
        .background(Color.screen.ignoresSafeArea())
        .tint(Color.ink)
    }
}
