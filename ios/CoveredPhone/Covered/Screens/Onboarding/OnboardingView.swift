// First launch, or whenever GET /api/memory says `onboarded: false`.
// Mirrors src/components/Onboarding.tsx: name, two pound rules, plain English, deposit.
import SwiftUI

struct OnboardingView: View {
    @Environment(AppModel.self) private var model

    private static let steps = 5

    @State private var step = 1
    @State private var name = ""
    @State private var settings: UserSettings = .defaults
    @State private var depositPence = 2000
    @State private var busy = false
    @State private var error: String?
    @FocusState private var nameFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BrandMark()
                .padding(.top, 18)

            Spacer(minLength: 24)

            Text("\(step) / \(Self.steps)")
                .font(.system(size: 11, weight: .medium))
                .tracking(2.4)
                .foregroundStyle(Theme.muted)
                .padding(.bottom, 28)

            Group {
                switch step {
                case 1: nameStep
                case 2: premiumStep
                case 3: switchStep
                case 4: plainEnglishStep
                default: depositStep
                }
            }
            .id(step)
            .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))

            if let error {
                Text(error)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.danger)
                    .padding(.top, 20)
            }

            Spacer(minLength: 24)

            HStack {
                Button("Back") { move(-1) }
                    .buttonStyle(.plain)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.muted)
                    .opacity(step == 1 || busy ? 0 : 1)
                    .disabled(step == 1 || busy)
                Spacer()
                if step < Self.steps {
                    Button("Continue") { move(1) }
                        .buttonStyle(PrimaryButtonStyle())
                } else {
                    HStack(spacing: 10) {
                        Button("Skip with £0") { finish(0) }
                            .buttonStyle(QuietButtonStyle())
                            .disabled(busy)
                        Button(busy ? "Saving…" : "Save and continue") { finish(depositPence) }
                            .buttonStyle(PrimaryButtonStyle())
                            .disabled(busy)
                    }
                }
            }
            .padding(.bottom, 24)
        }
        .padding(.horizontal, 28)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.background)
        .animation(Motion.spring, value: step)
        .onAppear { nameFocused = true }
    }

    private func move(_ delta: Int) {
        error = nil
        withAnimation(Motion.spring) {
            step = min(Self.steps, max(1, step + delta))
        }
    }

    private func finish(_ pence: Int) {
        busy = true
        error = nil
        Task {
            do {
                try await model.finishOnboarding(name: name, settings: settings, depositPence: pence)
            } catch let apiError as APIError {
                error = apiError.message
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }

    // MARK: Steps

    private var nameStep: some View {
        VStack(alignment: .leading, spacing: 28) {
            Text("What should it call you?")
                .headline(34)
            TextField("Your name", text: $name)
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(Theme.foreground)
                .textInputAutocapitalization(.words)
                .submitLabel(.next)
                .focused($nameFocused)
                .onSubmit { move(1) }
                .onChange(of: name) { _, next in
                    if next.count > 40 { name = String(next.prefix(40)) }
                }
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(nameFocused ? Theme.accent : Theme.line).frame(height: 1)
                }
        }
    }

    private var premiumStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Pay up to this much more to keep UK buyer rights")
                .headline(30)
            Text("Default £10. Covered will spend this extra to buy from a shop you can actually enforce against.")
                .font(.system(size: 15))
                .foregroundStyle(Theme.muted)
            PoundField(label: "Protection premium in pounds", pence: $settings.protectionPremiumPence, large: true)
        }
    }

    private var switchStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Inside 14 days, only switch if you clear this after postage")
                .headline(30)
            Text("Default £8. A cheaper find has to beat this after you pay to send the first one back.")
                .font(.system(size: 15))
                .foregroundStyle(Theme.muted)
            PoundField(label: "Switch minimum in pounds", pence: $settings.switchMinimumPence, large: true)
        }
    }

    private var plainEnglishStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("In plain English")
                .headline(34)
            Text("You will pay up to \(Money.format(settings.protectionPremiumPence)) extra for a UK shop with real returns, and only move after delivery if a cheaper listing still clears \(Money.format(settings.switchMinimumPence)) once postage is paid.")
                .font(.system(size: 18))
                .lineSpacing(4)
                .foregroundStyle(Theme.foreground)
            Text("If the cheapest fleece is a private seller at £28 and JD Sports has the same jacket at £36, Covered pays the extra £8 (inside your £10) so you keep 14-day cancellation and a 30-day fault refund.")
                .font(.system(size: 16))
                .lineSpacing(3)
                .foregroundStyle(Theme.muted)
        }
    }

    private var depositStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Deposit into the bot wallet")
                .headline(34)
            Text("Approve spends this ledger. Demo money only, no card. You can skip with £0 — Approve will not spend until there is money.")
                .font(.system(size: 15))
                .foregroundStyle(Theme.muted)
            PoundField(label: "Deposit amount in pounds", pence: $depositPence, large: true)
        }
    }
}
