import SwiftUI

struct OrdersView: View {
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Theme.pad) {
                Text("Orders")
                    .font(.largeTitle.weight(.semibold))
                // TODO: Agent B — Orders + Returns
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(Theme.padLarge)
            .background(Color.canvas.ignoresSafeArea())
            .navigationTitle("Orders")
        }
    }
}
