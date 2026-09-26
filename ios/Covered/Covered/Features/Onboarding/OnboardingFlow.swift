import SwiftUI

struct OnboardingFlow: View {
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Theme.pad) {
                Text("Covered")
                    .font(.largeTitle.weight(.semibold))
                Text("Onboarding")
                    .foregroundStyle(Color.muted)
                // TODO: Agent A — Onboarding + Shop
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(Theme.padLarge)
            .background(Color.canvas.ignoresSafeArea())
        }
    }
}
