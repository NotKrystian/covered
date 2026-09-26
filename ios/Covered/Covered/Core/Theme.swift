import SwiftUI

extension Color {
    /// Desk behind the phone in the film. Never an in-app fill.
    static let stage = Color(red: 235 / 255, green: 232 / 255, blue: 226 / 255)
    /// App background. The phone interior is white.
    static let screen = Color.white
    /// Primary chrome: approve, tab pill, send, handle, chosen stroke (`#0b0b0b`).
    static let ink = Color(red: 11 / 255, green: 11 / 255, blue: 11 / 255)
    /// Body copy on white (`#111111`).
    static let inkSoft = Color(red: 17 / 255, green: 17 / 255, blue: 17 / 255)
    /// Merchant, delivery, wallet label, gap labels (`#6f6d67`).
    static let secondary = Color(red: 111 / 255, green: 109 / 255, blue: 103 / 255)
    /// Placeholder, inactive tab, was-price, Face ID hint (`#8a877f`).
    static let tertiary = Color(red: 138 / 255, green: 135 / 255, blue: 127 / 255)
    /// Neutral chip copy (`#5e5c56`).
    static let chipText = Color(red: 94 / 255, green: 92 / 255, blue: 86 / 255)
    /// Price strike and rejected type (`#a3a19b`).
    static let mutedLine = Color(red: 163 / 255, green: 161 / 255, blue: 155 / 255)
    /// Signal green only — dots, meter, rights chip, success disc (`#5fd38a`).
    static let accent = Color(red: 95 / 255, green: 211 / 255, blue: 138 / 255)
    /// Copy on a green rights chip (`#0e2b19`).
    static let accentInk = Color(red: 14 / 255, green: 43 / 255, blue: 25 / 255)
    static let chipGood = Color(red: 226 / 255, green: 246 / 255, blue: 233 / 255)
    static let chipNeutral = Color(red: 239 / 255, green: 238 / 255, blue: 234 / 255)
    static let composer = Color(red: 240 / 255, green: 239 / 255, blue: 236 / 255)
    static let panel = Color(red: 243 / 255, green: 242 / 255, blue: 239 / 255)
    static let photoHole = Color(red: 232 / 255, green: 230 / 255, blue: 225 / 255)
    static let track = Color(red: 230 / 255, green: 228 / 255, blue: 223 / 255)
    static let trackIdle = Color(red: 221 / 255, green: 219 / 255, blue: 213 / 255)
    static let meterOver = Color(red: 185 / 255, green: 182 / 255, blue: 174 / 255)
    static let divider = Color(red: 235 / 255, green: 233 / 255, blue: 228 / 255)
    static let dividerStrong = Color(red: 226 / 255, green: 224 / 255, blue: 218 / 255)
    static let hairline = Color(red: 231 / 255, green: 229 / 255, blue: 224 / 255)
    static let grabber = Color(red: 217 / 255, green: 215 / 255, blue: 209 / 255)
    static let backdrop = Color.black.opacity(0.38)
    static let alertBody = Color(red: 220 / 255, green: 218 / 255, blue: 212 / 255)
    static let alertMeta = Color(red: 154 / 255, green: 151 / 255, blue: 143 / 255)
    static let memChip = Color(red: 35 / 255, green: 35 / 255, blue: 35 / 255)

    /// Legacy aliases so leftover call sites still compile.
    static let canvas = Color.screen
    static let muted = Color.secondary
    static let dangerGrey = Color.mutedLine
    static let chipFill = Color.chipNeutral
    static let accentSoft = Color.accent.opacity(0.12)
}

enum Theme {
    static let inset: CGFloat = 22
    static let padSmall: CGFloat = 7.5
    static let pad: CGFloat = 14.5
    static let padLarge: CGFloat = 22
    static let radius: CGFloat = 20
    static let radiusSmall: CGFloat = 11
    static let radiusPhoto: CGFloat = 14.5
    static let radiusPhotoDetail: CGFloat = 16.5
    static let radiusPhotoCompact: CGFloat = 13
    static let radiusComposer: CGFloat = 25.5
    static let radiusChip: CGFloat = 11
    static let radiusPick: CGFloat = 13
    static let radiusApprove: CGFloat = 35
    static let radiusSheet: CGFloat = 33
    static let radiusAlert: CGFloat = 24
    static let radiusTab: CGFloat = 18.5
    static let radiusHandle: CGFloat = 20
    static let radiusTrack: CGFloat = 6.5
    static let listPhoto: CGFloat = 130
    static let listPhotoCompact: CGFloat = 72
    static let approveHeight: CGFloat = 69.5
    static let successDisc: CGFloat = 117
    static let tabPillHeight: CGFloat = 36.5
    static let composerHeight: CGFloat = 51
}

// Font.ui / Font.money / filmText live in GeistFont.swift (Geist, SF Pro fallback).
