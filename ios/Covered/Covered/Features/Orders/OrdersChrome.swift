import SwiftUI

extension View {
    @ViewBuilder
    func ordersSwap() -> some View {
        if #available(iOS 18.0, *) {
            self.transition(.blurReplace)
        } else {
            self.transition(.opacity)
        }
    }
}
