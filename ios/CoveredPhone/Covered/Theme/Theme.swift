// Palette from src/app/globals.css. One accent. Springs, no bouncy easing.
import SwiftUI

enum Theme {
    static let background = Color(hex: 0x0B0C0E)
    static let foreground = Color(hex: 0xE6E7EA)
    static let panel = Color(hex: 0x121316)
    static let panelRaised = Color(hex: 0x17181C)
    static let line = Color(hex: 0x26282E)
    static let muted = Color(hex: 0x8B8F98)
    /// `--accent` from globals.css, also the AccentColor asset.
    static let accent = Color("AccentColor")
    static let accentSoft = Color(hex: 0x5FD38A).opacity(0.12)
    static let danger = Color(hex: 0xF0555B)

    static let cornerRadius: CGFloat = 16
}

enum Motion {
    /// The one spring. `.spring(response: 0.35, dampingFraction: 0.85)`.
    static let spring = Animation.spring(response: 0.35, dampingFraction: 0.85)
    static let slow = Animation.spring(response: 0.55, dampingFraction: 0.9)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

extension Font {
    static func display(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .default)
    }
}

extension View {
    /// Tight tracking like Geist headings.
    func headline(_ size: CGFloat = 28) -> some View {
        font(.display(size)).tracking(-0.6).foregroundStyle(Theme.foreground)
    }

    func panelCard(raised: Bool = false, border: Color = Theme.line) -> some View {
        background(
            RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous)
                .fill(raised ? Theme.panelRaised : Theme.panel)
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous)
                        .strokeBorder(border, lineWidth: 1)
                )
        )
    }

    func tabular() -> some View {
        monospacedDigit()
    }
}

struct Chip: View {
    let text: String
    var accent = false

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(accent ? Theme.accent : Theme.muted)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .overlay(
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .strokeBorder(accent ? Theme.accent : Theme.line, lineWidth: 1)
            )
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var full = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Theme.background)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(maxWidth: full ? .infinity : nil)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Theme.accent)
            )
            .opacity(configuration.isPressed ? 0.8 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(Motion.spring, value: configuration.isPressed)
    }
}

struct QuietButtonStyle: ButtonStyle {
    var full = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(Theme.muted)
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .frame(maxWidth: full ? .infinity : nil)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Theme.line, lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// "£" prefix + number pad. Pounds in, pence out.
struct PoundField: View {
    let label: String
    @Binding var pence: Int
    var large = false
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 6) {
            Text("£")
                .font(.system(size: large ? 34 : 17, weight: .medium))
                .foregroundStyle(Theme.muted)
            TextField("0", text: $text)
                .keyboardType(.decimalPad)
                .font(.system(size: large ? 40 : 18, weight: .semibold))
                .tabular()
                .foregroundStyle(Theme.foreground)
                .focused($focused)
                .accessibilityLabel(label)
                .onChange(of: text) { _, next in
                    if let parsed = Money.parsePounds(next) { pence = parsed }
                }
        }
        .padding(.horizontal, large ? 0 : 12)
        .padding(.vertical, large ? 6 : 8)
        .background {
            if large {
                VStack { Spacer(); Rectangle().fill(focused ? Theme.accent : Theme.line).frame(height: 1) }
            } else {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Theme.panelRaised)
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(focused ? Theme.accent : Theme.line))
            }
        }
        .onAppear { text = Money.poundsText(pence) }
    }
}

enum Haptics {
    static func tap() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    static func firm() {
        UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
    }

    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    static func failure() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
}
