import SwiftUI

extension Theme {
    static let background = Color.screen
    static let foreground = Color.inkSoft
    static let panelRaised = Color.panel
    static let accent = Color.accent
    static let muted = Color.secondary
}

extension View {
    func headline(_ size: CGFloat = 29) -> some View {
        filmText(size, weight: .bold, tracking: -0.9)
            .foregroundStyle(Color.inkSoft)
    }

    func screenFill() -> some View {
        background(Color.screen.ignoresSafeArea())
            .preferredColorScheme(.light)
            .tint(Color.ink)
    }
}

// MARK: - Header

struct CoveredWordmark: View {
    var body: some View {
        HStack(spacing: 2) {
            Text("Covered")
                .filmText(23, weight: .bold, tracking: -0.8)
                .foregroundStyle(Color.ink)
            Circle()
                .fill(Color.accent)
                .frame(width: 6.5, height: 6.5)
        }
        .accessibilityIdentifier("onboarding.wordmark")
        .accessibilityLabel("Covered")
    }
}

struct WalletChip: View {
    let pence: Int

    var body: some View {
        HStack(spacing: 6) {
            Text("Wallet")
                .filmText(12, weight: .medium)
                .foregroundStyle(Color.secondary)
            Text(formatGBP(pence))
                .filmMoney(16.5, weight: .semibold, tracking: -0.2)
                .foregroundStyle(Color.inkSoft)
                .contentTransition(.numericText())
                .animation(Motion.money, value: pence)
        }
        .padding(.horizontal, 13)
        .frame(height: 35)
        .background(Color.panel, in: Capsule())
    }
}

struct FilmHeader: View {
    var showWallet = false
    var balancePence: Int = 0

    var body: some View {
        HStack(alignment: .center) {
            CoveredWordmark()
            Spacer()
            if showWallet {
                WalletChip(pence: balancePence)
            }
        }
        .padding(.horizontal, Theme.inset)
        .padding(.top, 8)
        .padding(.bottom, 6)
    }
}

// MARK: - Composer

struct ComposerBar: View {
    @Binding var text: String
    var placeholder: String
    var identifier: String
    var sendIdentifier: String
    var focused: FocusState<Bool>.Binding
    var enabled: Bool
    var onSend: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            TextField(placeholder, text: $text)
                .font(.system(size: 15.5, weight: .regular))
                .foregroundStyle(Color.inkSoft)
                .focused(focused)
                .submitLabel(.send)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .disabled(!enabled)
                .padding(.horizontal, 20)
                .frame(height: Theme.composerHeight)
                .background(Color.composer, in: Capsule())
                .accessibilityIdentifier(identifier)
                .onSubmit { if enabled { onSend() } }

            Button(action: onSend) {
                SendChevron()
                    .frame(width: 22, height: 22)
                    .frame(width: Theme.composerHeight, height: Theme.composerHeight)
                    .background(Color.ink, in: Circle())
            }
            .buttonStyle(PressScaleStyle(scale: 0.92))
            .disabled(!enabled || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .opacity(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.45 : 1)
            .accessibilityIdentifier(sendIdentifier)
            .accessibilityLabel("Search")
        }
    }
}

struct SendChevron: View {
    var body: some View {
        Path { path in
            path.move(to: CGPoint(x: 11, y: 19))
            path.addLine(to: CGPoint(x: 11, y: 5))
            path.move(to: CGPoint(x: 5.5, y: 11.5))
            path.addLine(to: CGPoint(x: 11, y: 5))
            path.addLine(to: CGPoint(x: 16.5, y: 11.5))
        }
        .stroke(Color.white, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
    }
}

struct SentBubble: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 17.5, weight: .medium))
            .tracking(-0.2)
            .foregroundStyle(Color.white)
            .lineLimit(2)
            .padding(20)
            .frame(maxWidth: 302, alignment: .leading)
            .background(Color.ink, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

struct TypingDots: View {
    @State private var phase = 0.0

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(Color.tertiary)
                    .frame(width: 7.5, height: 7.5)
                    .offset(y: -4 * sin(phase + Double(index) * 0.9))
                    .opacity(0.45 + 0.55 * (0.5 + 0.5 * sin(phase + Double(index) * 0.9)))
            }
        }
        .padding(.horizontal, 18)
        .frame(width: 71, height: 40)
        .background(Color.composer, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .onAppear {
            withAnimation(.linear(duration: 0.42).repeatForever(autoreverses: false)) {
                phase = .pi * 2
            }
        }
    }
}

// MARK: - Chips

struct RightsChip: View {
    var text: String = "14-day cancellation · 30-day fault refund"
    var compact = false

    var body: some View {
        HStack(spacing: 6) {
            ChipCheck()
                .frame(width: 12, height: 12)
            Text(text)
                .font(.system(size: compact ? 12 : 12, weight: .medium))
                .foregroundStyle(Color.accentInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, compact ? 9 : 12)
        .padding(.vertical, compact ? 6.5 : 8)
        .background(Color.chipGood, in: Capsule())
    }
}

struct NeutralChip: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Color.chipText)
            .padding(.horizontal, 9)
            .padding(.vertical, 6.5)
            .background(Color.chipNeutral, in: Capsule())
    }
}

struct CoveredPickLabel: View {
    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(Color.accent)
                .frame(width: 6.5, height: 6.5)
            Text("Covered pick")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.white)
        }
        .padding(.horizontal, 10)
        .frame(height: 26)
        .background(Color.ink, in: Capsule())
    }
}

private struct ChipCheck: View {
    var body: some View {
        Path { path in
            path.move(to: CGPoint(x: 1.5, y: 6.5))
            path.addLine(to: CGPoint(x: 4.5, y: 9.5))
            path.addLine(to: CGPoint(x: 10.5, y: 2.5))
        }
        .stroke(Color.accentInk, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
    }
}

// MARK: - Buttons

struct PressScaleStyle: ButtonStyle {
    var scale: CGFloat = 0.965

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .animation(Motion.press, value: configuration.isPressed)
    }
}

struct InkPillButton: View {
    let title: String
    var enabled = true
    var identifier: String?
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 18.5, weight: .semibold))
                .tracking(-0.2)
                .foregroundStyle(Color.white)
                .frame(maxWidth: .infinity)
                .frame(height: Theme.approveHeight)
                .background(Color.ink, in: Capsule())
        }
        .buttonStyle(PressScaleStyle(scale: 0.965))
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
        .accessibilityIdentifier(identifier ?? "")
    }
}

struct QuietTextButton: View {
    let title: String
    var action: () -> Void

    var body: some View {
        Button(title, action: action)
            .font(.system(size: 14, weight: .regular))
            .foregroundStyle(Color.secondary)
    }
}

struct FilmCard<Content: View>: View {
    var chosen = false
    var fill: Color = .white
    var radius: CGFloat = Theme.radius
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .background(fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(chosen ? Color.ink : Color.hairline, lineWidth: chosen ? 2.5 : 1)
            )
    }
}

// MARK: - Premium control

struct PremiumControl: View {
    @Binding var premiumPence: Int
    var gapPence: Int?
    var shopWins: Bool
    var verdictLead: String
    var verdictBody: String
    var range: ClosedRange<Int> = 0...3_000
    var onEditingChanged: (Bool) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let gapPence, let line = gapLine(gapPence) {
                meterRow(label: "Gap", value: line)
                meterRow(
                    label: "Rights premium",
                    value: "\(formatGBP(min(gapPence, premiumPence)))  of  \(formatGBP(premiumPence))"
                )
                track(gap: gapPence)
            }

            handle

            VStack(alignment: .leading, spacing: 4) {
                Text(verdictLead)
                    .font(.system(size: 17.5, weight: .semibold))
                    .tracking(-0.3)
                    .foregroundStyle(Color.inkSoft)
                Text(verdictBody)
                    .font(.system(size: 14.5, weight: .regular))
                    .foregroundStyle(Color.chipText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .coveredSwap()
        }
    }

    private func meterRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.secondary)
            Spacer()
            Text(value)
                .filmMoney(16.5, weight: .semibold, tracking: -0.2)
                .foregroundStyle(Color.inkSoft)
        }
    }

    private func track(gap: Int) -> some View {
        GeometryReader { geo in
            let cap = max(gap, premiumPence, 1)
            let green = CGFloat(min(gap, premiumPence)) / CGFloat(cap)
            ZStack(alignment: .leading) {
                Capsule().fill(Color.track)
                Capsule()
                    .fill(Color.accent)
                    .frame(width: max(0, geo.size.width * green))
                if gap > premiumPence {
                    Capsule()
                        .fill(Color.meterOver)
                        .frame(width: max(0, geo.size.width * (1 - green)))
                        .offset(x: geo.size.width * green)
                }
                Rectangle()
                    .fill(Color.ink)
                    .frame(width: 2.5, height: 27.5)
                    .offset(x: geo.size.width * CGFloat(premiumPence) / CGFloat(cap) - 1.25)
            }
        }
        .frame(height: 13)
    }

    private var handle: some View {
        GeometryReader { geo in
            let span = CGFloat(range.upperBound - range.lowerBound)
            let t = span == 0 ? 0 : CGFloat(premiumPence - range.lowerBound) / span
            let width: CGFloat = 139
            let x = (geo.size.width - width) * t
            Text("Pay up to \(formatGBP(premiumPence).replacingOccurrences(of: ".00", with: ""))")
                .font(.system(size: 14.5, weight: .semibold))
                .foregroundStyle(Color.white)
                .frame(width: width, height: 40)
                .background(Color.ink, in: Capsule())
                .offset(x: x)
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            let raw = (value.location.x / max(geo.size.width, 1)) * span
                            let pounds = Int((raw / 100).rounded())
                            let next = min(range.upperBound, max(range.lowerBound, pounds * 100))
                            if next != premiumPence {
                                premiumPence = next
                                Haptics.light()
                            }
                            onEditingChanged(true)
                        }
                        .onEnded { _ in
                            onEditingChanged(false)
                        }
                )
                .animation(Motion.drag, value: premiumPence)
        }
        .frame(height: 40)
        .accessibilityIdentifier("shop.premium")
    }

    private func gapLine(_ gap: Int) -> String? {
        guard gap > 0 else { return nil }
        return formatGBP(gap)
    }
}

// MARK: - Tab bar

struct CoveredTabBar: View {
    @Binding var selection: CoveredTabs.Tab
    @Namespace private var pill

    var body: some View {
        HStack(spacing: 0) {
            ForEach(CoveredTabs.Tab.allCases) { tab in
                Button {
                    withAnimation(Motion.lead) { selection = tab }
                    Haptics.light()
                } label: {
                    Text(tab.title)
                        .font(.system(size: 14.5, weight: .semibold))
                        .foregroundStyle(selection == tab ? Color.white : Color.tertiary)
                        .padding(.horizontal, 18)
                        .frame(height: Theme.tabPillHeight)
                        .background {
                            if selection == tab {
                                Capsule()
                                    .fill(Color.ink)
                                    .matchedGeometryEffect(id: "tab-pill", in: pill)
                            }
                        }
                }
                .buttonStyle(PressScaleStyle(scale: 0.95))
                .accessibilityIdentifier(tab.identifier)
                .accessibilityLabel(tab.title)
                .accessibilityAddTraits(selection == tab ? [.isSelected, .isButton] : .isButton)
            }
        }
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background(Color.screen)
    }
}

extension APIError {
    var message: String { errorDescription ?? "Something broke." }
}

/// RootView / onboarding still look for these names.
struct CoveredPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 18.5, weight: .semibold))
            .tracking(-0.2)
            .foregroundStyle(Color.white)
            .frame(maxWidth: .infinity)
            .frame(height: Theme.approveHeight)
            .background(Color.ink, in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.965 : 1)
            .animation(Motion.press, value: configuration.isPressed)
    }
}

struct CoveredQuietButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .regular))
            .foregroundStyle(Color.secondary)
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        CoveredPrimaryButtonStyle().makeBody(configuration: configuration)
    }
}

struct QuietButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        CoveredQuietButtonStyle().makeBody(configuration: configuration)
    }
}
