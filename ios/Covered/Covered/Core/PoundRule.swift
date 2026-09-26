import Foundation

/// A seller you can enforce against at a venue that honours it. A business badge alone is not this.
func isProtected(_ decision: Decision) -> Bool {
    decision.sellerType == .ukBusiness
        && (decision.venueTrust == .shopCheckout || decision.venueTrust == .marketplaceProtected)
}

/// Listings that survived identity and the photo check — the pound rule's input.
func survivorsForPremium(
    items: [ShortlistItem],
    decisions: [String: Decision]
) -> [ShortlistItem] {
    items.filter { item in
        guard let decision = decisions[item.id] else { return false }
        return !decision.mislisting && decision.sameItem
    }
}

/// `(protected − unprotected) / protected` as integer basis points (10000 = 100%).
func discountRatioBps(protected: Int, unprotected: Int) -> Int {
    guard protected > 0 else { return 0 }
    if unprotected >= protected { return 0 }
    return (protected - unprotected) * 10_000 / protected
}

/// Shop wins when the discount is inside the buyer's percent cap, or when there is
/// no unprotected listing, or when the shop is already cheaper.
func shopBeatsPremium(protected: Int, unprotected: Int?, bps: Int) -> Bool {
    guard let unprotected else { return true }
    if unprotected >= protected { return true }
    return (protected - unprotected) * 10_000 <= bps * protected
}

func formatPercentBps(_ bps: Int) -> String {
    "\(max(0, bps / 100))%"
}

/// Apply the protection premium to whatever survived the judge.
///
/// Drops mislistings and anything that is not the item. Among the rest, finds the
/// cheapest protected and the cheapest unprotected. The shop wins when
/// `discount_ratio * 10000 <= protection_premium_bps` (2500 = 25%), or when the
/// shop is cheaper, or when nothing unprotected survived.
func applyPremium(
    items: [ShortlistItem],
    decisions: [String: Decision],
    settings: UserSettings
) -> Verdict {
    let premiumBps = settings.protectionPremiumBps
    var survivors: [ShortlistItem] = []
    var dropped = 0
    for item in items {
        guard let decision = decisions[item.id], !decision.mislisting, decision.sameItem else {
            dropped += 1
            continue
        }
        guard item.pricePence != nil else { continue }
        survivors.append(item)
    }

    let protectedBest = cheapest(survivors.filter { item in
        guard let decision = decisions[item.id] else { return false }
        return isProtected(decision)
    })
    let unprotectedBest = cheapest(survivors.filter { item in
        guard let decision = decisions[item.id] else { return true }
        return !isProtected(decision)
    })

    let droppedNote: String
    if dropped > 0 {
        droppedNote = " \(dropped) listing\(dropped == 1 ? "" : "s") dropped before price."
    } else {
        droppedNote = ""
    }

    if let protectedBest, let protectedPrice = protectedBest.pricePence {
        let unprotectedPrice = unprotectedBest?.pricePence
        if shopBeatsPremium(protected: protectedPrice, unprotected: unprotectedPrice, bps: premiumBps) {
            let discount = unprotectedBest.flatMap { best in
                best.pricePence.map { discountRatioBps(protected: protectedPrice, unprotected: $0) }
            } ?? 0
            let summary: String
            if unprotectedBest == nil {
                summary = "Buying \(protectedBest.merchant) at \(formatGBP(protectedPrice)), the only listing that is the item and keeps your rights.\(droppedNote)"
            } else if discount <= 0 {
                summary = "Buying \(protectedBest.merchant) at \(formatGBP(protectedPrice)): the cheapest listing that is the item, and it keeps your rights (14-day cancellation and a 30-day fault refund). No premium needed.\(droppedNote)"
            } else {
                let other = unprotectedBest?.merchant ?? ""
                summary = "Buying \(protectedBest.merchant) at \(formatGBP(protectedPrice)). That is \(formatPercentBps(discount)) more than \(other), inside your \(formatPercentBps(premiumBps)) for rights: 14-day cancellation and a 30-day fault refund.\(droppedNote)"
            }
            return Verdict(chosenId: protectedBest.id, perOffer: decisions, summary: summary)
        }
    }

    if let unprotectedBest, let unprotectedPrice = unprotectedBest.pricePence {
        let summary: String
        if let protectedBest, let protectedPrice = protectedBest.pricePence {
            let discount = discountRatioBps(protected: protectedPrice, unprotected: unprotectedPrice)
            summary = "Buying \(unprotectedBest.merchant) at \(formatGBP(unprotectedPrice)): \(formatPercentBps(discount)) cheaper than \(protectedBest.merchant), which beats your \(formatPercentBps(premiumBps)), but a break is your problem. No cooling-off, no Consumer Rights Act remedy.\(droppedNote)"
        } else {
            summary = "No listing with UK rights survived. \(unprotectedBest.merchant) at \(formatGBP(unprotectedPrice)) is the item, but a break is your problem.\(droppedNote)"
        }
        return Verdict(chosenId: unprotectedBest.id, perOffer: decisions, summary: summary)
    }

    return Verdict(
        chosenId: nil,
        perOffer: decisions,
        summary: "Nothing to buy. No listing survived the photo and identity check.\(droppedNote)"
    )
}

func cheapest(_ items: [ShortlistItem]) -> ShortlistItem? {
    var best: ShortlistItem?
    for item in items {
        guard let price = item.pricePence else { continue }
        if let current = best, let currentPrice = current.pricePence {
            if price < currentPrice { best = item }
        } else {
            best = item
        }
    }
    return best
}
