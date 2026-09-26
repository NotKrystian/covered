import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            switch model.phase {
            case .loading:
                LoadingView()
                    .transition(.opacity)
            case .failed(let message):
                FailedView(message: message)
                    .transition(.opacity)
            case .onboarding:
                OnboardingView()
                    .transition(.opacity)
            case .ready:
                MainTabView()
                    .transition(.opacity)
            }
        }
        .animation(Motion.spring, value: model.phase)
        .task { await model.bootstrap() }
    }
}

private struct LoadingView: View {
    var body: some View {
        VStack(spacing: 14) {
            BrandMark()
            Text("Reading your memory…")
                .font(.system(size: 14))
                .foregroundStyle(Theme.muted)
        }
    }
}

private struct FailedView: View {
    @Environment(AppModel.self) private var model
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            BrandMark()
            Text("Could not reach Covered")
                .headline(26)
            Text(message)
                .font(.system(size: 15))
                .foregroundStyle(Theme.muted)
            Text("Server: \(model.baseURLString)")
                .font(.system(size: 13))
                .foregroundStyle(Theme.muted)
            HStack {
                Button("Try again") { Task { await model.bootstrap() } }
                    .buttonStyle(PrimaryButtonStyle())
                Button("Use covered.kawuc.uk") {
                    model.baseURLString = CoveredAPI.defaultBase
                    Task { await model.bootstrap() }
                }
                .buttonStyle(QuietButtonStyle())
            }
        }
        .padding(28)
    }
}

struct BrandMark: View {
    var body: some View {
        HStack(spacing: 3) {
            Text("Covered")
                .font(.system(size: 15, weight: .semibold))
                .tracking(-0.3)
                .foregroundStyle(Theme.foreground)
            Circle().fill(Theme.accent).frame(width: 7, height: 7).offset(y: 2)
        }
    }
}

struct MainTabView: View {
    enum Tab: String { case shop, orders, limits, settings }

    @State private var tab: Tab = Tab(rawValue: LaunchFlags.demoTab ?? "") ?? .shop

    var body: some View {
        TabView(selection: $tab) {
            HomeView()
                .tabItem { Label("Shop", systemImage: "bag") }
                .tag(Tab.shop)
            OrdersView()
                .tabItem { Label("Orders", systemImage: "receipt") }
                .tag(Tab.orders)
            LimitsView()
                .tabItem { Label("Limits", systemImage: "gauge.with.dots.needle.33percent") }
                .tag(Tab.limits)
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(Tab.settings)
        }
        .toolbarBackground(Theme.panel, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
    }
}
