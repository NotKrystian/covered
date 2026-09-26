import SwiftUI

struct ShopView: View {
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Theme.pad) {
                Text("Shop")
                    .font(.largeTitle.weight(.semibold))
                // TODO: Agent A — Onboarding + Shop
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(Theme.padLarge)
            .background(Color.canvas.ignoresSafeArea())
            .navigationTitle("Shop")
        }
    }
}
