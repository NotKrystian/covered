import SwiftUI
import UIKit

enum GeistFont {
    static let family = "Geist"
    static let fileName = "Geist-Variable"

    static var isBundled: Bool {
        UIFont(name: family, size: 17) != nil
            || !UIFont.fontNames(forFamilyName: family).isEmpty
    }

    static func uiFont(size: CGFloat, weight: Font.Weight, tabular: Bool = false) -> UIFont {
        let base = UIFont(name: family, size: size)
            ?? UIFont.systemFont(ofSize: size, weight: uiKitWeight(weight))
        var attributes: [UIFontDescriptor.AttributeName: Any] = [
            .traits: [UIFontDescriptor.TraitKey.weight: uiKitWeight(weight).rawValue],
        ]
        if tabular {
            attributes[.featureSettings] = [[
                UIFontDescriptor.FeatureKey.type: kNumberSpacingType,
                UIFontDescriptor.FeatureKey.selector: kMonospacedNumbersSelector,
            ]]
        }
        let descriptor = base.fontDescriptor.addingAttributes(attributes)
        return UIFont(descriptor: descriptor, size: size)
    }

    private static func uiKitWeight(_ weight: Font.Weight) -> UIFont.Weight {
        switch weight {
        case .ultraLight: return .ultraLight
        case .thin: return .thin
        case .light: return .light
        case .regular: return .regular
        case .medium: return .medium
        case .semibold: return .semibold
        case .bold: return .bold
        case .heavy: return .heavy
        case .black: return .black
        default: return .regular
        }
    }
}

extension Font {
    static func money(_ size: CGFloat = 17, weight: Weight = .semibold) -> Font {
        Font(GeistFont.uiFont(size: size, weight: weight, tabular: true))
    }

    static func ui(_ size: CGFloat, weight: Weight = .regular) -> Font {
        Font(GeistFont.uiFont(size: size, weight: weight))
    }
}

extension View {
    func filmText(_ size: CGFloat, weight: Font.Weight, tracking: CGFloat = 0) -> some View {
        font(.ui(size, weight: weight))
            .tracking(tracking)
    }

    func filmMoney(_ size: CGFloat, weight: Font.Weight, tracking: CGFloat = 0) -> some View {
        font(.money(size, weight: weight))
            .tracking(tracking)
    }
}
