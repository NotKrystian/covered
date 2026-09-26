import SwiftUI

struct SettingsView: View {
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Theme.pad) {
                Text("Settings")
                    .font(.largeTitle.weight(.semibold))
                // TODO: Agent C — Wallet + Limits + Settings
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(Theme.padLarge)
            .background(Color.canvas.ignoresSafeArea())
            .navigationTitle("Settings")
        }
    }
}
