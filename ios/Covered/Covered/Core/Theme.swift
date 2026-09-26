import SwiftUI

extension Color {
    /// Calm green — `--accent` / `#5fd38a`.
    static let accent = Color(red: 95 / 255, green: 211 / 255, blue: 138 / 255)
    static let accentSoft = Color(red: 95 / 255, green: 211 / 255, blue: 138 / 255).opacity(0.12)
    /// Light warm-grey canvas from the product film (`#ebe8e2`).
    static let canvas = Color(red: 235 / 255, green: 232 / 255, blue: 226 / 255)
    /// Near-black body copy (`#111111`).
    static let ink = Color(red: 17 / 255, green: 17 / 255, blue: 17 / 255)
    /// Rejected rows: grey strike-through, not red (`#a3a19b`).
    static let dangerGrey = Color(red: 163 / 255, green: 161 / 255, blue: 155 / 255)
    static let muted = Color(red: 111 / 255, green: 109 / 255, blue: 103 / 255)
    static let chipFill = Color(red: 239 / 255, green: 238 / 255, blue: 234 / 255)
}

enum Theme {
    static let padSmall: CGFloat = 8
    static let pad: CGFloat = 16
    static let padLarge: CGFloat = 24
    static let radius: CGFloat = 22
    static let radiusSmall: CGFloat = 12
}

extension Font {
    /// SF Pro with tabular figures — money, wallet, prices.
    static func money(_ size: CGFloat = 17, weight: Weight = .semibold) -> Font {
        .system(size: size, weight: weight).monospacedDigit()
    }

    static func ui(_ size: CGFloat, weight: Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .default)
    }
}
