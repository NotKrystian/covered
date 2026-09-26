import SwiftUI

/// One idea per screen: name, two pound rules, the example, pair, deposit.
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
            CoveredWordmark()
                .padding(.top, 8)

            Text("\(step) / \(Self.steps)")
                .font(.system(size: 12, weight: .medium))
                .tracking(2)
                .foregroundStyle(Color.tertiary)
                .padding(.top, Theme.padLarge)
                .padding(.bottom, 28)

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
            .coveredSwap()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            if let error {
                Text(error)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.secondary)
                    .padding(.top, Theme.pad)
            }

            footer
        }
        .padding(.horizontal, Theme.inset)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.screen.ignoresSafeArea())
        .animation(Motion.soft, value: step)
        .onAppear { nameFocused = true }
        .onTapGesture { nameFocused = false }
    }

    private var footer: some View {
        HStack {
            QuietTextButton(title: "Back") { move(-1) }
                .opacity(step == 1 || busy ? 0 : 1)
                .disabled(step == 1 || busy)

            Spacer()

            if step == 5 {
                QuietTextButton(title: "Skip") { move(1) }
                    .padding(.trailing, 12)
                    .disabled(busy)
                    .accessibilityIdentifier("onboarding.skipPair")
            }

            if step < Self.steps {
                Button("Continue") { move(1) }
                    .buttonStyle(CoveredPrimaryButtonStyle())
                    .disabled(busy)
                    .accessibilityIdentifier("onboarding.continue")
                    .frame(width: 180)
            } else {
                HStack(spacing: 10) {
                    QuietTextButton(title: "Skip") { finish(deposit: 0) }
                        .disabled(busy)
                        .accessibilityIdentifier("onboarding.skipDeposit")
                    Button(busy ? "Saving…" : "Save") { finish(deposit: depositPence) }
                        .buttonStyle(CoveredPrimaryButtonStyle())
                        .disabled(busy)
                        .accessibilityIdentifier("onboarding.save")
                        .frame(width: 160)
                }
            }
        }
    }

    private func move(_ delta: Int) {
        error = nil
        withAnimation(Motion.soft) {
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
                .headline(29)
            TextField("Your name", text: $name)
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(Color.inkSoft)
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
                        .fill(nameFocused ? Color.accent : Color.hairline)
                        .frame(height: 1)
                }
        }
    }

    private var premiumStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Pay up to \(formatPercentBps(settings.protectionPremiumBps)) more to keep UK buyer rights.")
                .headline(29)
            PremiumControl(
                value: $settings.protectionPremiumBps,
                unit: .percentBps,
                shopWins: true,
                verdictLead: "Pay up to \(formatPercentBps(settings.protectionPremiumBps))",
                verdictBody: "Covered spends this extra share of the UK shop price to buy from a shop you can enforce against."
            )
        }
    }

    private var switchStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Only switch inside 14 days if I still clear £\(settings.switchMinimumPence / 100) after postage.")
                .headline(29)
            PremiumControl(
                value: $settings.switchMinimumPence,
                unit: .pence,
                shopWins: true,
                verdictLead: "Switch floor \(formatGBP(settings.switchMinimumPence))",
                verdictBody: "A cheaper find has to beat this after you pay to send the first one back."
            )
        }
    }

    private var explainStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("In plain English")
                .headline(29)
            HStack(spacing: 11) {
                miniCard(title: "Private", price: "£28", chip: "private sale")
                miniCard(title: "UK shop", price: "£36", chip: "14-day cancellation", good: true)
            }
            RightsChip()
            Text("22% ≤ \(formatPercentBps(settings.protectionPremiumBps)) · shop wins")
                .font(.system(size: 17.5, weight: .semibold))
                .tracking(-0.3)
                .foregroundStyle(Color.inkSoft)
            Text("Your numbers: pay up to \(formatPercentBps(settings.protectionPremiumBps)) of the UK shop price for rights, and only move after delivery if a cheaper listing still clears \(formatGBP(settings.switchMinimumPence)) once postage is paid.")
                .font(.system(size: 14.5))
                .foregroundStyle(Color.secondary)
        }
    }

    private func miniCard(title: String, price: String, chip: String, good: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(price)
                .filmMoney(29, weight: .bold, tracking: -0.9)
            Text(title)
                .font(.system(size: 14, weight: .medium))
            if good {
                RightsChip(text: chip, compact: true)
            } else {
                NeutralChip(text: chip)
            }
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                .strokeBorder(Color.hairline, lineWidth: 1)
        )
    }

    private var pairStep: some View {
        PairingView(embedded: true)
    }

    private var depositStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Deposit into the bot wallet")
                .headline(29)
            Text("Approve spends this ledger. Demo money only — skip if you want.")
                .font(.system(size: 14.5))
                .foregroundStyle(Color.secondary)
            HStack(spacing: 8) {
                ForEach([10, 20, 50], id: \.self) { pounds in
                    Button("£\(pounds)") {
                        depositPence = pounds * 100
                        Haptics.light()
                    }
                    .font(.money(15, weight: .semibold))
                    .foregroundStyle(Color.ink)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(
                        (depositPence == pounds * 100 ? Color.accent : Color.panel),
                        in: Capsule()
                    )
                    .accessibilityIdentifier("onboarding.deposit\(pounds)")
                }
            }
        }
    }
}

struct OnboardingView: View {
    var body: some View {
        OnboardingFlow()
    }
}
