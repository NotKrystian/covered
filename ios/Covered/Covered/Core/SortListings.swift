import Foundation

/// Client-side listing sort, ported from `src/lib/sort-listings.ts`.
enum SortKey: String, CaseIterable, Identifiable, Sendable, Hashable {
    case priceAsc = "price_asc"
    case priceDesc = "price_desc"
    case brand
    case shipping
    case protections

    var id: String { rawValue }

    var label: String {
        switch self {
        case .priceAsc: return "Price low→high"
        case .priceDesc: return "Price high→low"
        case .brand: return "Brand"
        case .shipping: return "Shipping cost"
        case .protections: return "Buyer protections"
        }
    }

    static let `default`: SortKey = .priceAsc
}

enum ListingSort {
    static func firstTitleToken(_ title: String) -> String {
        for token in title.split(whereSeparator: { $0.isWhitespace }) {
            let cleaned = token.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
            if cleaned.isEmpty { continue }
            if cleaned.lowercased() == "the" { continue }
            return String(cleaned)
        }
        return ""
    }

    /// Brand is not a structured field. Prefer the research brief when the title starts with it.
    static func listingBrand(_ item: ShortlistItem, briefBrand: String) -> String {
        let brand = briefBrand.trimmingCharacters(in: .whitespaces)
        if !brand.isEmpty, item.title.lowercased().hasPrefix(brand.lowercased()) {
            return brand
        }
        let token = firstTitleToken(item.title)
        return token.isEmpty ? item.merchant : token
    }

    private static let poundPattern = try? NSRegularExpression(
        pattern: #"£\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?"#
    )

    static func poundAmount(in text: String) -> Int? {
        guard let poundPattern,
              let match = poundPattern.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let poundsRange = Range(match.range(at: 1), in: text)
        else { return nil }
        let pounds = Int(text[poundsRange].replacingOccurrences(of: ",", with: "")) ?? 0
        var pence = 0
        if match.range(at: 2).location != NSNotFound, let penceRange = Range(match.range(at: 2), in: text) {
            pence = Int(String(text[penceRange]).padding(toLength: 2, withPad: "0", startingAt: 0)) ?? 0
        }
        return pounds * 100 + pence
    }

    /// Shipping cost in pence, or nil when unknown (sorts last). "free" → 0.
    static func shippingPence(_ delivery: String?) -> Int? {
        guard let delivery, !delivery.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        let text = delivery.lowercased()
        if text.range(of: #"\bfree\b"#, options: .regularExpression) != nil { return 0 }
        if let amount = poundAmount(in: delivery) { return amount }
        if text.range(of: #"\bcollection only\b"#, options: .regularExpression) != nil { return 0 }
        if text.range(of: #"\bclick\s*(?:and|&)\s*collect\b"#, options: .regularExpression) != nil { return 0 }
        return nil
    }

    static func mentionsFourteenOrFreeReturns(_ returns: String?) -> Bool {
        guard let returns else { return false }
        let text = returns.lowercased()
        return text.range(of: #"\b14[-\s]?day"#, options: .regularExpression) != nil
            || text.range(of: #"\bfree returns\b"#, options: .regularExpression) != nil
    }

    /// Strongest first: 0 = UK shop / 14-day, … 4 = unclear. Sponsored is ignored.
    static func protectionRank(_ item: ShortlistItem, decision: Decision?) -> Int {
        if let decision {
            let returnsBoost = mentionsFourteenOrFreeReturns(item.returns)
            if decision.sellerType == .ukBusiness && (decision.venueTrust == .shopCheckout || returnsBoost) {
                return 0
            }
            if decision.sellerType == .ukBusiness || decision.venueTrust == .marketplaceProtected {
                return 1
            }
            if decision.sellerType == .overseasBusiness {
                return 2
            }
            if decision.sellerType == .privateSeller || decision.venueTrust == .stranger {
                return 3
            }
            return 4
        }
        let hay = "\(item.returns ?? "") \(item.delivery ?? "") \(item.venueHint ?? "") \(item.merchant)".lowercased()
        if mentionsFourteenOrFreeReturns(item.returns) { return 0 }
        if hay.range(of: #"\bmarketplace[, ]*protected\b"#, options: .regularExpression) != nil
            || hay.range(of: #"\bbuyer protection\b"#, options: .regularExpression) != nil {
            return 1
        }
        if hay.range(of: #"\boverseas\b"#, options: .regularExpression) != nil
            || hay.range(of: #"\bships from\b"#, options: .regularExpression) != nil
            || hay.range(of: #"\binternational\b"#, options: .regularExpression) != nil {
            return 2
        }
        if hay.range(of: #"\bprivate\b"#, options: .regularExpression) != nil
            || hay.range(of: #"\bstranger\b"#, options: .regularExpression) != nil
            || hay.range(of: #"\bfacebook\b"#, options: .regularExpression) != nil {
            return 3
        }
        return 4
    }

    private static func compareCash(_ a: ShortlistItem, _ b: ShortlistItem, desc: Bool) -> Int {
        switch (a.pricePence, b.pricePence) {
        case (nil, nil): return 0
        case (nil, _): return 1
        case (_, nil): return -1
        case let (x?, y?): return desc ? y - x : x - y
        }
    }

    private static func compareMonthly(_ a: ShortlistItem, _ b: ShortlistItem, desc: Bool) -> Int {
        switch (a.monthlyPence, b.monthlyPence) {
        case (nil, nil): return 0
        case (nil, _): return 1
        case (_, nil): return -1
        case let (x?, y?): return desc ? y - x : x - y
        }
    }

    private static func comparePriceAsc(_ a: ShortlistItem, _ b: ShortlistItem) -> Int {
        switch (isMonthlyOnly(a), isMonthlyOnly(b)) {
        case (true, false): return 1
        case (false, true): return -1
        case (true, true): return compareMonthly(a, b, desc: false)
        case (false, false): return compareCash(a, b, desc: false)
        }
    }

    private static func comparePriceDesc(_ a: ShortlistItem, _ b: ShortlistItem) -> Int {
        switch (isMonthlyOnly(a), isMonthlyOnly(b)) {
        case (true, false): return 1
        case (false, true): return -1
        case (true, true): return compareMonthly(a, b, desc: true)
        case (false, false): return compareCash(a, b, desc: true)
        }
    }

    static func pinChosen(_ items: [ShortlistItem], chosenId: String?) -> [ShortlistItem] {
        guard let chosenId, let index = items.firstIndex(where: { $0.id == chosenId }), index > 0 else {
            return items
        }
        let chosen = items[index]
        if isMonthlyOnly(chosen) { return items }
        var next = items
        next.remove(at: index)
        next.insert(chosen, at: 0)
        return next
    }

    static func sort(
        _ items: [ShortlistItem],
        by key: SortKey,
        decisions: [String: Decision] = [:],
        briefBrand: String = "",
        chosenId: String? = nil
    ) -> [ShortlistItem] {
        let sorted = items.sorted { a, b in
            let aMo = isMonthlyOnly(a)
            let bMo = isMonthlyOnly(b)
            if aMo != bMo { return !aMo }
            let cmp: Int
            switch key {
            case .priceAsc:
                cmp = comparePriceAsc(a, b)
            case .priceDesc:
                cmp = comparePriceDesc(a, b)
            case .brand:
                let left = listingBrand(a, briefBrand: briefBrand)
                let right = listingBrand(b, briefBrand: briefBrand)
                let order = left.compare(right, options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en"))
                cmp = order == .orderedSame ? comparePriceAsc(a, b) : (order == .orderedAscending ? -1 : 1)
            case .shipping:
                switch (shippingPence(a.delivery), shippingPence(b.delivery)) {
                case (nil, nil):
                    cmp = comparePriceAsc(a, b)
                case (nil, _):
                    cmp = 1
                case (_, nil):
                    cmp = -1
                case let (x?, y?):
                    cmp = x == y ? comparePriceAsc(a, b) : x - y
                }
            case .protections:
                let rank = protectionRank(a, decision: decisions[a.id]) - protectionRank(b, decision: decisions[b.id])
                cmp = rank == 0 ? comparePriceAsc(a, b) : rank
            }
            return cmp < 0
        }
        return pinChosen(sorted, chosenId: chosenId)
    }
}
