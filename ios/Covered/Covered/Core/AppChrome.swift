import SwiftUI

extension Theme {
    static let background = Color.canvas
    static let foreground = Color.ink
    static let panel = Color.ink
    static let panelRaised = Color.ink
    static let accent = Color.accent
    static let muted = Color.muted
}

extension View {
    func headline(_ size: CGFloat = 28) -> some View {
        font(.ui(size, weight: .semibold))
            .tracking(-0.6)
            .foregroundStyle(Theme.foreground)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
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

struct QuietButtonStyle: ButtonStyle {
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

extension APIError {
    var message: String { errorDescription ?? "Something broke." }
}
