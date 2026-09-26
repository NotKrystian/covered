// Client sort, ported from src/lib/sort-listings.ts. Operates on rows already
// loaded; never re-fetches. The verdict's chosen row is pinned first after any sort.
import Foundation

enum SortKey: String, CaseIterable, Identifiable {
    case priceAsc = "price_asc"
    case priceDesc = "price_desc"
    case brand
    case shipping
    case protections

    var id: String { rawValue }

    var label: String {
        switch self {
        case .priceAsc: return "Price · low to high"
        case .priceDesc: return "Price · high to low"
        case .brand: return "Brand"
        case .shipping: return "Shipping cost"
        case .protections: return "Buyer protections"
        }
    }

    static let `default`: SortKey = .priceAsc
}

enum ListingSort {
    private static func firstTitleToken(_ title: String) -> String {
        for token in title.split(whereSeparator: { $0.isWhitespace }) {
            let cleaned = token.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
            if cleaned.isEmpty || cleaned.lowercased() == "the" { continue }
            return cleaned
        }
        return ""
    }

    static func brand(_ item: ShortlistItem, briefBrand: String) -> String {
        let brand = briefBrand.trimmingCharacters(in: .whitespaces)
        if !brand.isEmpty, item.title.lowercased().hasPrefix(brand.lowercased()) { return brand }
        let token = firstTitleToken(item.title)
        return token.isEmpty ? item.merchant : token
    }

    private static let poundPattern = try? NSRegularExpression(pattern: "£\\s*(\\d{1,3}(?:,\\d{3})*|\\d+)(?:\\.(\\d{1,2}))?")

    private static func poundAmount(in text: String) -> Int? {
        guard let poundPattern,
              let match = poundPattern.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let poundsRange = Range(match.range(at: 1), in: text) else { return nil }
        let pounds = Int(text[poundsRange].replacingOccurrences(of: ",", with: "")) ?? 0
        var pence = 0
        if let penceRange = Range(match.range(at: 2), in: text) {
            pence = Int(String(text[penceRange]).padding(toLength: 2, withPad: "0", startingAt: 0)) ?? 0
        }
        return pounds * 100 + pence
    }

    /// Shipping pence, or nil when unknown (sorts last). free → 0; collection → 0.
    static func shippingPence(_ delivery: String?) -> Int? {
        guard let delivery, !delivery.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        let text = delivery.lowercased()
        if text.range(of: "\\bfree\\b", options: .regularExpression) != nil { return 0 }
        if let amount = poundAmount(in: delivery) { return amount }
        if text.range(of: "\\bcollection only\\b", options: .regularExpression) != nil
            || text.range(of: "\\bclick\\s*(?:and|&)\\s*collect\\b", options: .regularExpression) != nil {
            return 0
        }
        return nil
    }

    private static func mentionsFourteenOrFreeReturns(_ returns: String?) -> Bool {
        guard let returns else { return false }
        let text = returns.lowercased()
        return text.range(of: "\\b14[-\\s]?day", options: .regularExpression) != nil
            || text.range(of: "\\bfree returns\\b", options: .regularExpression) != nil
    }

    /// 0 strongest … 4 unclear. Sponsored is ignored.
    static func protectionRank(_ item: ShortlistItem, decision: Decision?) -> Int {
        if let d = decision {
            let boost = mentionsFourteenOrFreeReturns(item.returns)
            if d.sellerType == .ukBusiness && (d.venueTrust == .shopCheckout || boost) { return 0 }
            if d.sellerType == .ukBusiness || d.venueTrust == .marketplaceProtected { return 1 }
            if d.sellerType == .overseasBusiness { return 2 }
            if d.sellerType == .privateSeller || d.venueTrust == .stranger { return 3 }
            return 4
        }
        let hay = "\(item.returns ?? "") \(item.delivery ?? "") \(item.venueHint ?? "") \(item.merchant)".lowercased()
        if mentionsFourteenOrFreeReturns(item.returns) { return 0 }
        if hay.range(of: "\\bmarketplace[, ]*protected\\b", options: .regularExpression) != nil
            || hay.range(of: "\\bbuyer protection\\b", options: .regularExpression) != nil { return 1 }
        if hay.range(of: "\\boverseas\\b|\\bships from\\b|\\binternational\\b", options: .regularExpression) != nil { return 2 }
        if hay.range(of: "\\bprivate\\b|\\bstranger\\b|\\bfacebook\\b", options: .regularExpression) != nil { return 3 }
        return 4
    }

    private static func priceAsc(_ a: ShortlistItem, _ b: ShortlistItem) -> Int {
        switch (a.pricePence, b.pricePence) {
        case (nil, nil): return 0
        case (nil, _): return 1
        case (_, nil): return -1
        case (let x?, let y?): return x - y
        }
    }

    static func sort(_ items: [ShortlistItem], by key: SortKey, decisions: [String: Decision],
                     briefBrand: String, chosenId: String?) -> [ShortlistItem] {
        let sorted = items.sorted { a, b in
            let cmp: Int
            switch key {
            case .priceAsc:
                cmp = priceAsc(a, b)
            case .priceDesc:
                cmp = -priceAsc(a, b)
            case .brand:
                let order = brand(a, briefBrand: briefBrand).localizedCaseInsensitiveCompare(brand(b, briefBrand: briefBrand))
                cmp = order == .orderedSame ? priceAsc(a, b) : (order == .orderedAscending ? -1 : 1)
            case .shipping:
                switch (shippingPence(a.delivery), shippingPence(b.delivery)) {
                case (nil, nil): cmp = priceAsc(a, b)
                case (nil, _): cmp = 1
                case (_, nil): cmp = -1
                case (let x?, let y?): cmp = x == y ? priceAsc(a, b) : x - y
                }
            case .protections:
                let rank = protectionRank(a, decision: decisions[a.id]) - protectionRank(b, decision: decisions[b.id])
                cmp = rank == 0 ? priceAsc(a, b) : rank
            }
            return cmp < 0
        }
        return pinChosen(sorted, chosenId: chosenId)
    }

    static func pinChosen(_ items: [ShortlistItem], chosenId: String?) -> [ShortlistItem] {
        guard let chosenId, let index = items.firstIndex(where: { $0.id == chosenId }), index > 0 else { return items }
        var next = items
        let chosen = next.remove(at: index)
        next.insert(chosen, at: 0)
        return next
    }
}
