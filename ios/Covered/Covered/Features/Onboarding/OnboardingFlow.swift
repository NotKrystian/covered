import SwiftUI

/// One calm step per screen: name, two pound rules, the fleece sentence, pair, deposit.
struct OnboardingFlow: View {
    var onFinished: ((Memory?) -> Void)?

    private static let steps = 6

    @State private var step = 1
    @State private var name = ""
    @State private var settings = UserSettings.defaults
    @State private var depositPence = 0
    @State private var busy = false
    @State private var error: String?
    @FocusState private var nameFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Covered")
                .font(.ui(15, weight: .semibold))
                .foregroundStyle(Color.ink)
                .padding(.top, 8)
                .accessibilityIdentifier("onboarding.wordmark")

            Text("\(step) / \(Self.steps)")
                .font(.ui(12, weight: .medium))
                .tracking(2)
                .foregroundStyle(Color.muted)
                .padding(.top, Theme.padLarge)
                .padding(.bottom, 36)

            Group {
                switch step {
                case 1: nameStep
                case 2: premiumStep
                case 3: switchStep
                case 4: explainStep
                case 5: pairStep
                default: depositStep
                }
            }
            .id(step)
            .transition(.blurReplace)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            if let error {
                Text(error)
                    .font(.ui(14))
                    .foregroundStyle(Color.muted)
                    .padding(.top, Theme.pad)
            }

            footer
        }
        .padding(.horizontal, 28)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.canvas.ignoresSafeArea())
        .animation(.spring(response: 0.35, dampingFraction: 0.9), value: step)
        .onAppear { nameFocused = true }
        .onTapGesture { nameFocused = false }
    }

    private var footer: some View {
        HStack {
            Button("Back") { move(-1) }
                .font(.ui(15))
                .foregroundStyle(Color.muted)
                .opacity(step == 1 || busy ? 0 : 1)
                .disabled(step == 1 || busy)

            Spacer()

            if step == 5 {
                Button("Skip") { move(1) }
                    .font(.ui(15, weight: .medium))
                    .foregroundStyle(Color.muted)
                    .padding(.trailing, 12)
                    .disabled(busy)
                    .accessibilityIdentifier("onboarding.skipPair")
            }

            if step < Self.steps {
                Button("Continue") { move(1) }
                    .buttonStyle(CoveredPrimaryButtonStyle())
                    .disabled(busy)
                    .accessibilityIdentifier("onboarding.continue")
            } else {
                HStack(spacing: 10) {
                    Button("Skip") { finish(deposit: 0) }
                        .buttonStyle(CoveredQuietButtonStyle())
                        .disabled(busy)
                        .accessibilityIdentifier("onboarding.skipDeposit")
                    Button(busy ? "Saving…" : "Save") { finish(deposit: depositPence) }
                        .buttonStyle(CoveredPrimaryButtonStyle())
                        .disabled(busy)
                        .accessibilityIdentifier("onboarding.save")
                }
            }
        }
    }

    private func move(_ delta: Int) {
        error = nil
        withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) {
            step = min(Self.steps, max(1, step + delta))
        }
    }

    private func finish(deposit pence: Int) {
        busy = true
        error = nil
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            do {
                try await AppState.shared.completeOnboarding(
                    displayName: trimmed.isEmpty ? nil : trimmed,
                    settings: settings,
                    depositPence: max(0, pence)
                )
                onFinished?(AppState.shared.memory)
            } catch let apiError as APIError {
                error = apiError.errorDescription ?? "Could not save."
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }

    private var nameStep: some View {
        VStack(alignment: .leading, spacing: 28) {
            Text("What should it call you?")
                .font(.ui(32, weight: .semibold))
                .foregroundStyle(Color.ink)
            TextField("Your name", text: $name)
                .font(.ui(26, weight: .medium))
                .foregroundStyle(Color.ink)
                .textInputAutocapitalization(.words)
                .submitLabel(.next)
                .focused($nameFocused)
                .accessibilityIdentifier("onboarding.name")
                .onSubmit { move(1) }
                .onChange(of: name) { _, next in
                    if next.count > 40 { name = String(next.prefix(40)) }
                }
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) {
                    Rectangle()
                        .fill(nameFocused ? Color.accent : Color.muted.opacity(0.35))
                        .frame(height: 1)
                }
        }
    }

    private var premiumStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Pay up to £\(settings.protectionPremiumPence / 100) more to keep UK buyer rights")
                .font(.ui(28, weight: .semibold))
                .foregroundStyle(Color.ink)
            Text("Default £10. Covered spends this extra to buy from a shop you can enforce against.")
                .font(.ui(16))
                .foregroundStyle(Color.muted)
            PoundStepper(pence: $settings.protectionPremiumPence)
        }
    }

    private var switchStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Inside 14 days, only switch if I clear £\(settings.switchMinimumPence / 100) after postage")
                .font(.ui(28, weight: .semibold))
                .foregroundStyle(Color.ink)
            Text("Default £8. A cheaper find has to beat this after you pay to send the first one back.")
                .font(.ui(16))
                .foregroundStyle(Color.muted)
            PoundStepper(pence: $settings.switchMinimumPence)
        }
    }

    private var explainStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("In plain English")
                .font(.ui(32, weight: .semibold))
                .foregroundStyle(Color.ink)
            Text("A £28 private seller vs a £36 UK shop: £8 is inside your £10, so it buys the shop and keeps your 14-day returns.")
                .font(.ui(20))
                .lineSpacing(6)
                .foregroundStyle(Color.ink)
            Text("Your numbers: pay up to \(formatGBP(settings.protectionPremiumPence)) for rights, and only move after delivery if a cheaper listing still clears \(formatGBP(settings.switchMinimumPence)) once postage is paid.")
                .font(.ui(16))
                .foregroundStyle(Color.muted)
        }
    }

    private var pairStep: some View {
        PairingView(embedded: true)
    }

    private var depositStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Deposit into the bot wallet")
                .font(.ui(32, weight: .semibold))
                .foregroundStyle(Color.ink)
            Text("Approve spends this ledger. Demo money only — skip if you want. You can add more later.")
                .font(.ui(16))
                .foregroundStyle(Color.muted)
            PoundStepper(pence: $depositPence, range: 0...50_000)
            HStack(spacing: 8) {
                ForEach([10, 20, 50], id: \.self) { pounds in
                    Button("£\(pounds)") {
                        depositPence = pounds * 100
                        Haptics.light()
                    }
                    .font(.money(15, weight: .semibold))
                    .foregroundStyle(depositPence == pounds * 100 ? Color.ink : Color.ink.opacity(0.7))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(
                        (depositPence == pounds * 100 ? Color.accent : Color.ink.opacity(0.08)),
                        in: Capsule()
                    )
                    .accessibilityIdentifier("onboarding.deposit\(pounds)")
                }
            }
        }
    }
}

/// Large monospaced pounds with a stepper. Binding is integer pence.
struct PoundStepper: View {
    @Binding var pence: Int
    var range: ClosedRange<Int> = 0...5_000
    var step: Int = 100

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 18) {
            Button {
                pence = max(range.lowerBound, pence - step)
                Haptics.light()
            } label: {
                Image(systemName: "minus")
                    .font(.ui(18, weight: .semibold))
                    .foregroundStyle(Color.canvas)
                    .frame(width: 44, height: 44)
                    .background(Color.ink, in: Circle())
            }
            .disabled(pence <= range.lowerBound)
            .accessibilityIdentifier("onboarding.stepperMinus")

            Text(formatGBP(pence))
                .font(.money(44, weight: .semibold))
                .foregroundStyle(Color.ink)
                .contentTransition(.numericText())
                .animation(.spring(response: 0.35, dampingFraction: 0.9), value: pence)
                .frame(maxWidth: .infinity)

            Button {
                pence = min(range.upperBound, pence + step)
                Haptics.light()
            } label: {
                Image(systemName: "plus")
                    .font(.ui(18, weight: .semibold))
                    .foregroundStyle(Color.ink)
                    .frame(width: 44, height: 44)
                    .background(Color.accent, in: Circle())
            }
            .disabled(pence >= range.upperBound)
            .accessibilityIdentifier("onboarding.stepperPlus")
        }
        .padding(.top, 12)
    }
}

struct CoveredPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.ui(16, weight: .semibold))
            .foregroundStyle(Color.ink)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous)
                    .fill(Color.accent)
            )
            .opacity(configuration.isPressed ? 0.8 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.spring(response: 0.35, dampingFraction: 0.9), value: configuration.isPressed)
    }
}

struct CoveredQuietButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.ui(16, weight: .medium))
            .foregroundStyle(Color.muted)
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .background(
                RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous)
                    .strokeBorder(Color.muted.opacity(0.35), lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// Alias kept so any leftover call site still compiles.
struct OnboardingView: View {
    var body: some View {
        OnboardingFlow()
    }
}
