import SwiftUI

enum Motion {
    static let ui = Animation.spring(response: 0.35, dampingFraction: 0.80)
    static let snap = Animation.spring(response: 0.24, dampingFraction: 0.82)
    static let soft = Animation.spring(response: 0.50, dampingFraction: 0.84)
    static let land = Animation.spring(response: 0.42, dampingFraction: 0.80)
    static let enter = Animation.spring(response: 0.33, dampingFraction: 0.80)
    static let exit = Animation.spring(response: 0.21, dampingFraction: 0.95)
    static let press = Animation.spring(response: 0.15, dampingFraction: 0.90)
    static let money = Animation.spring(response: 0.39, dampingFraction: 1.00)
    static let ring = Animation.spring(response: 0.52, dampingFraction: 1.00)
    static let merge = Animation.spring(response: 0.45, dampingFraction: 1.00)
    static let lead = Animation.spring(response: 0.24, dampingFraction: 0.82)
    static let trail = Animation.spring(response: 0.52, dampingFraction: 0.90)
    static let drag = Animation.spring(response: 0.45, dampingFraction: 1.00)

    /// Legacy alias used by older screens.
    static let spring = ui

    static let blur: CGFloat = 6.5
}

extension View {
    @ViewBuilder
    func coveredSwap(blur: CGFloat = Motion.blur) -> some View {
        if #available(iOS 18.0, *) {
            self.transition(.blurReplace)
        } else {
            self.transition(.opacity.combined(with: .offset(y: 7)))
        }
    }

    func ordersSwap() -> some View {
        coveredSwap()
    }
}
