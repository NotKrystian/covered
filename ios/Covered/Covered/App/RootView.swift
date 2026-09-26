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
        .animation(Motion.spring, value: state.onboarded)
        .task { await state.refresh() }
        .preferredColorScheme(.light)
    }
}

private struct MainTabs: View {
    @Bindable private var tabs = CoveredTabs.shared

    var body: some View {
        TabView(selection: $tabs.selection) {
            ShopView()
                .tabItem { Label("Shop", systemImage: "bag") }
                .tag(CoveredTabs.Tab.shop)
            OrdersView()
                .tabItem { Label("Orders", systemImage: "shippingbox") }
                .tag(CoveredTabs.Tab.orders)
            WalletView()
                .tabItem { Label("Wallet", systemImage: "creditcard") }
                .tag(CoveredTabs.Tab.wallet)
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(CoveredTabs.Tab.settings)
        }
        .tint(Color.accent)
    }
}
