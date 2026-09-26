// Codable mirrors of src/lib/types.ts, src/lib/decision.ts and src/lib/memory/index.ts.
// Every field keeps its wire name via explicit CodingKeys so ids such as
// "sponsored-abc_def" in dictionaries are never rewritten by a key strategy.
import Foundation

// MARK: - Enums

enum OfferSection: String, Codable, Hashable {
    case sponsored, browse
}

enum ReceiptSection: String, Codable, Hashable {
    case sponsored, browse, fixture
}

enum SearchSource: String, Codable, Hashable {
    case live, fixture, snapshot
}

enum SellerType: String, Codable, Hashable {
    case ukBusiness = "uk_business"
    case privateSeller = "private"
    case overseasBusiness = "overseas_business"
    case unclear
}

enum VenueTrust: String, Codable, Hashable {
    case shopCheckout = "shop_checkout"
    case marketplaceProtected = "marketplace_protected"
    case marketplaceUnprotected = "marketplace_unprotected"
    case stranger
    case unclear
}

enum Recommendation: String, Codable, Hashable {
    case buy, skip, ask
}

enum ApprovalMode: String, Codable, Hashable {
    case ask, auto
}

// MARK: - Offer (one Google Shopping card)

struct Offer: Codable, Hashable {
    var section: OfferSection
    var position: Int?
    var title: String
    var price: String
    var pricePence: Int?
    var compareAt: String?
    var merchant: String
    var merchantDomain: String?
    var merchantId: String?
    var offerId: String?
    var offerDocid: String?
    var location: String?
    var badge: String?
    var delivery: String?
    var returns: String?
    var energy: String?
    var rating: String?
    var ratingCount: String?
    var specs: [String]?
    var productUrl: String?
    var moreMerchants: String?
    var summary: String?
    var imageUrls: [String]?
    var imageUrl: String?
    var imageDataUrl: String?

    enum CodingKeys: String, CodingKey {
        case section, position, title, price
        case pricePence = "price_pence"
        case compareAt = "compare_at"
        case merchant
        case merchantDomain = "merchant_domain"
        case merchantId = "merchant_id"
        case offerId = "offer_id"
        case offerDocid = "offer_docid"
        case location, badge, delivery, returns, energy, rating
        case ratingCount = "rating_count"
        case specs
        case productUrl = "product_url"
        case moreMerchants = "more_merchants"
        case summary
        case imageUrls = "image_urls"
        case imageUrl = "image_url"
        case imageDataUrl = "image_data_url"
    }

    // zod marks compare_at, badge, delivery, rating and rating_count as
    // nullable-but-required, so they must go on the wire as explicit null.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(section, forKey: .section)
        try c.encodeIfPresent(position, forKey: .position)
        try c.encode(title, forKey: .title)
        try c.encode(price, forKey: .price)
        try c.encodeIfPresent(pricePence, forKey: .pricePence)
        try c.encode(compareAt, forKey: .compareAt)
        try c.encode(merchant, forKey: .merchant)
        try c.encodeIfPresent(merchantDomain, forKey: .merchantDomain)
        try c.encodeIfPresent(merchantId, forKey: .merchantId)
        try c.encodeIfPresent(offerId, forKey: .offerId)
        try c.encodeIfPresent(offerDocid, forKey: .offerDocid)
        try c.encodeIfPresent(location, forKey: .location)
        try c.encode(badge, forKey: .badge)
        try c.encode(delivery, forKey: .delivery)
        try c.encodeIfPresent(returns, forKey: .returns)
        try c.encodeIfPresent(energy, forKey: .energy)
        try c.encode(rating, forKey: .rating)
        try c.encode(ratingCount, forKey: .ratingCount)
        try c.encodeIfPresent(specs, forKey: .specs)
        try c.encodeIfPresent(productUrl, forKey: .productUrl)
        try c.encodeIfPresent(moreMerchants, forKey: .moreMerchants)
        try c.encodeIfPresent(summary, forKey: .summary)
        try c.encodeIfPresent(imageUrls, forKey: .imageUrls)
        try c.encodeIfPresent(imageUrl, forKey: .imageUrl)
        try c.encodeIfPresent(imageDataUrl, forKey: .imageDataUrl)
    }
}

// MARK: - Listing (seeded fixture with photos)

struct Listing: Codable, Hashable {
    var id: String
    var title: String
    var pricePence: Int
    var merchant: String
    var sellerTypeHint: String?
    var venue: String
    var imageUrls: [String]
    var returnsText: String
    var deliveryText: String
    var rating: String?
    var url: String?

    enum CodingKeys: String, CodingKey {
        case id, title
        case pricePence = "price_pence"
        case merchant
        case sellerTypeHint = "seller_type_hint"
        case venue
        case imageUrls = "image_urls"
        case returnsText = "returns_text"
        case deliveryText = "delivery_text"
        case rating, url
    }
}

// MARK: - Judge output

struct Decision: Codable, Hashable {
    var sameItem: Bool
    var mislisting: Bool
    var photoReason: String?
    var sponsored: Bool
    var sellerType: SellerType
    var venueTrust: VenueTrust
    var rights: [String]
    var recommendation: Recommendation
    var reason: String

    enum CodingKeys: String, CodingKey {
        case sameItem = "same_item"
        case mislisting
        case photoReason = "photo_reason"
        case sponsored
        case sellerType = "seller_type"
        case venueTrust = "venue_trust"
        case rights, recommendation, reason
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(sameItem, forKey: .sameItem)
        try c.encode(mislisting, forKey: .mislisting)
        try c.encode(photoReason, forKey: .photoReason)
        try c.encode(sponsored, forKey: .sponsored)
        try c.encode(sellerType, forKey: .sellerType)
        try c.encode(venueTrust, forKey: .venueTrust)
        try c.encode(rights, forKey: .rights)
        try c.encode(recommendation, forKey: .recommendation)
        try c.encode(reason, forKey: .reason)
    }

    /// Dropped before any price comparison.
    var rejected: Bool { mislisting || !sameItem }

    /// A seller you can enforce against at a venue that honours it (mirrors `isProtected`).
    var isProtected: Bool {
        sellerType == .ukBusiness && (venueTrust == .shopCheckout || venueTrust == .marketplaceProtected)
    }

    var sellerLine: String {
        let seller: String
        switch sellerType {
        case .ukBusiness: seller = "UK business"
        case .privateSeller: seller = "private seller"
        case .overseasBusiness: seller = "overseas business"
        case .unclear: seller = "seller unclear"
        }
        let venue: String
        switch venueTrust {
        case .shopCheckout: venue = "shop checkout"
        case .marketplaceProtected: venue = "marketplace, protected"
        case .marketplaceUnprotected: venue = "marketplace, unprotected"
        case .stranger: venue = "stranger"
        case .unclear: venue = "venue unclear"
        }
        return "\(seller) · \(venue)"
    }
}

struct Verdict: Codable, Hashable {
    var chosenId: String?
    var perOffer: [String: Decision]
    var summary: String

    enum CodingKeys: String, CodingKey {
        case chosenId = "chosen_id"
        case perOffer = "per_offer"
        case summary
    }
}

// MARK: - Shortlist row (what /api/decide renders)

enum RawItem: Codable, Hashable {
    case offer(Offer)
    case listing(Listing)

    private enum CodingKeys: String, CodingKey { case kind, offer, listing }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try c.decode(String.self, forKey: .kind)
        switch kind {
        case "offer":
            self = .offer(try c.decode(Offer.self, forKey: .offer))
        case "listing":
            self = .listing(try c.decode(Listing.self, forKey: .listing))
        default:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown raw kind \(kind)")
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .offer(let offer):
            try c.encode("offer", forKey: .kind)
            try c.encode(offer, forKey: .offer)
        case .listing(let listing):
            try c.encode("listing", forKey: .kind)
            try c.encode(listing, forKey: .listing)
        }
    }

    /// The receipt's `chosen` field: the Offer or Listing itself, untagged.
    var chosenPayload: ChosenPayload {
        switch self {
        case .offer(let offer): return .offer(offer)
        case .listing(let listing): return .listing(listing)
        }
    }
}

enum ChosenPayload: Encodable {
    case offer(Offer)
    case listing(Listing)

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .offer(let offer): try c.encode(offer)
        case .listing(let listing): try c.encode(listing)
        }
    }
}

struct ShortlistItem: Codable, Hashable, Identifiable {
    var id: String
    var title: String
    var pricePence: Int?
    var priceLabel: String
    var merchant: String
    var delivery: String?
    var returns: String?
    var rating: String?
    var ratingCount: String?
    var section: ReceiptSection
    var badge: String?
    var venueHint: String?
    var sellerTypeHint: String?
    var imageUrls: [String]
    var imageUrl: String?
    var imageDataUrl: String?
    var productUrl: String?
    var raw: RawItem

    enum CodingKeys: String, CodingKey {
        case id, title
        case pricePence = "price_pence"
        case priceLabel = "price_label"
        case merchant, delivery, returns, rating
        case ratingCount = "rating_count"
        case section, badge
        case venueHint = "venue_hint"
        case sellerTypeHint = "seller_type_hint"
        case imageUrls = "image_urls"
        case imageUrl = "image_url"
        case imageDataUrl = "image_data_url"
        case productUrl = "product_url"
        case raw
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        pricePence = try c.decodeIfPresent(Int.self, forKey: .pricePence)
        priceLabel = try c.decode(String.self, forKey: .priceLabel)
        merchant = try c.decode(String.self, forKey: .merchant)
        delivery = try c.decodeIfPresent(String.self, forKey: .delivery)
        returns = try c.decodeIfPresent(String.self, forKey: .returns)
        rating = try c.decodeIfPresent(String.self, forKey: .rating)
        ratingCount = try c.decodeIfPresent(String.self, forKey: .ratingCount)
        section = try c.decode(ReceiptSection.self, forKey: .section)
        badge = try c.decodeIfPresent(String.self, forKey: .badge)
        venueHint = try c.decodeIfPresent(String.self, forKey: .venueHint)
        sellerTypeHint = try c.decodeIfPresent(String.self, forKey: .sellerTypeHint)
        imageUrls = try c.decodeIfPresent([String].self, forKey: .imageUrls) ?? []
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        imageDataUrl = try c.decodeIfPresent(String.self, forKey: .imageDataUrl)
        productUrl = try c.decodeIfPresent(String.self, forKey: .productUrl)
        raw = try c.decode(RawItem.self, forKey: .raw)
    }

    /// Merchant product URL when there is a safe http(s) one. Never a Google tracker.
    var productLink: URL? {
        let candidate: String?
        if let productUrl, !productUrl.isEmpty {
            candidate = productUrl
        } else {
            switch raw {
            case .offer(let offer): candidate = offer.productUrl
            case .listing(let listing): candidate = listing.url
            }
        }
        guard let candidate, let url = URL(string: candidate), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else { return nil }
        return url
    }
}

struct TraceEvent: Codable, Hashable {
    var t: String
    var tool: String
    var detail: String
}

struct DecideResponse: Codable {
    var verdict: Verdict
    var decisions: [String: Decision]
    var shortlist: [ShortlistItem]
    var listings: [ShortlistItem]
    var mode: String
    var model: String
    var trace: [TraceEvent]
    var premiumPaidPence: Int?
    var learned: Bool
    var briefBrand: String

    enum CodingKeys: String, CodingKey {
        case verdict, decisions, shortlist, listings, mode, model, trace
        case premiumPaidPence = "premium_paid_pence"
        case learned
        case briefBrand = "brief_brand"
    }

    var chosen: ShortlistItem? {
        guard let id = verdict.chosenId else { return nil }
        return listings.first { $0.id == id } ?? shortlist.first { $0.id == id }
    }
}

// MARK: - Settings and memory

struct UserSettings: Codable, Hashable {
    var protectionPremiumPence: Int
    var switchMinimumPence: Int
    var approval: ApprovalMode

    enum CodingKeys: String, CodingKey {
        case protectionPremiumPence = "protection_premium_pence"
        case switchMinimumPence = "switch_minimum_pence"
        case approval
    }

    static let defaults = UserSettings(protectionPremiumPence: 1000, switchMinimumPence: 800, approval: .ask)

    init(protectionPremiumPence: Int, switchMinimumPence: Int, approval: ApprovalMode) {
        self.protectionPremiumPence = protectionPremiumPence
        self.switchMinimumPence = switchMinimumPence
        self.approval = approval
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        protectionPremiumPence = try c.decodeIfPresent(Int.self, forKey: .protectionPremiumPence) ?? 1000
        switchMinimumPence = try c.decodeIfPresent(Int.self, forKey: .switchMinimumPence) ?? 800
        approval = try c.decodeIfPresent(ApprovalMode.self, forKey: .approval) ?? .ask
    }
}

enum MemoryEventKind: String, Codable, Hashable {
    case decision, approve, override
}

struct MemoryEvent: Codable, Hashable {
    var t: String
    var kind: MemoryEventKind
    var query: String
    var chosenId: String?
    var premiumPence: Int
    var note: String

    enum CodingKeys: String, CodingKey {
        case t, kind, query
        case chosenId = "chosen_id"
        case premiumPence = "premium_pence"
        case note
    }
}

enum AftercareRemedy: String, Codable, Hashable {
    case refund, replace, repair, none
}

struct AftercareEntry: Codable, Hashable {
    var t: String
    var remedy: AftercareRemedy
    var refused: Bool
    var note: String
}

struct OrderRecord: Codable, Hashable, Identifiable {
    var id: String
    var t: String
    var query: String
    var title: String
    var merchant: String
    var pricePence: Int
    var section: ReceiptSection
    var aftercare: [AftercareEntry]

    enum CodingKeys: String, CodingKey {
        case id, t, query, title, merchant
        case pricePence = "price_pence"
        case section, aftercare
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        t = try c.decode(String.self, forKey: .t)
        query = try c.decode(String.self, forKey: .query)
        title = try c.decode(String.self, forKey: .title)
        merchant = try c.decode(String.self, forKey: .merchant)
        pricePence = try c.decode(Int.self, forKey: .pricePence)
        section = try c.decode(ReceiptSection.self, forKey: .section)
        aftercare = try c.decodeIfPresent([AftercareEntry].self, forKey: .aftercare) ?? []
    }
}

struct Deposit: Codable, Hashable {
    var t: String
    var amountPence: Int

    enum CodingKeys: String, CodingKey {
        case t
        case amountPence = "amount_pence"
    }
}

enum LimitStatus: String, Codable, Hashable {
    case watching, filled, paused
}

struct Limit: Codable, Hashable, Identifiable {
    var id: String
    var query: String
    var maxPricePence: Int
    var status: LimitStatus
    var createdAt: String
    var lastCheckedAt: String
    var lastResult: String
    var filledOrderId: String?

    enum CodingKeys: String, CodingKey {
        case id, query
        case maxPricePence = "max_price_pence"
        case status
        case createdAt = "created_at"
        case lastCheckedAt = "last_checked_at"
        case lastResult = "last_result"
        case filledOrderId = "filled_order_id"
    }
}

struct Memory: Codable, Hashable {
    var userId: String
    var displayName: String?
    var summary: String
    var settings: UserSettings
    var events: [MemoryEvent]
    var orders: [OrderRecord]
    var balancePence: Int
    var deposits: [Deposit]
    var limits: [Limit]
    var onboarded: Bool
    var updatedAt: String

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case displayName = "display_name"
        case summary, settings, events, orders
        case balancePence = "balance_pence"
        case deposits, limits, onboarded
        case updatedAt = "updated_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userId = try c.decode(String.self, forKey: .userId)
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
        summary = try c.decodeIfPresent(String.self, forKey: .summary) ?? ""
        settings = try c.decodeIfPresent(UserSettings.self, forKey: .settings) ?? .defaults
        events = try c.decodeIfPresent([MemoryEvent].self, forKey: .events) ?? []
        orders = try c.decodeIfPresent([OrderRecord].self, forKey: .orders) ?? []
        balancePence = try c.decodeIfPresent(Int.self, forKey: .balancePence) ?? 0
        deposits = try c.decodeIfPresent([Deposit].self, forKey: .deposits) ?? []
        limits = try c.decodeIfPresent([Limit].self, forKey: .limits) ?? []
        onboarded = try c.decodeIfPresent(Bool.self, forKey: .onboarded) ?? false
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
    }
}

// MARK: - Reader

enum ReaderErrorKind: String, Codable, Hashable {
    case challenge, timeout
    case noOffers = "no_offers"
    case unknown
}

struct ReaderError: Codable, Hashable {
    var kind: ReaderErrorKind
    var message: String
}

struct SearchResult: Codable, Hashable {
    var query: String
    var fetchedAt: String
    var source: SearchSource
    var offers: [Offer]
    var note: String?
    var fallbackFrom: ReaderError?

    enum CodingKeys: String, CodingKey {
        case query
        case fetchedAt = "fetched_at"
        case source, offers, note
        case fallbackFrom = "fallback_from"
    }
}

// MARK: - Aftercare

struct AftercareTurn: Codable, Hashable {
    enum Role: String, Codable, Hashable { case user, assistant }
    var role: Role
    var text: String
}

struct AftercareAssist: Codable, Hashable {
    var reply: String
    var remedy: AftercareRemedy
    var right: String
    var draftToSeller: String?
    var refused: Bool
    var mode: String?
    var orderId: String?

    enum CodingKeys: String, CodingKey {
        case reply, remedy, right
        case draftToSeller = "draft_to_seller"
        case refused, mode
        case orderId = "order_id"
    }

    var outcomeLine: String {
        if refused {
            return right.range(of: "change of mind", options: .caseInsensitive) != nil
                ? "Refused: that is a change of mind"
                : "Refused: \(right)"
        }
        switch remedy {
        case .refund:
            if right.contains("30") { return "Refund under the 30-day right" }
            if right.contains("14") || right.range(of: "cooling", options: .caseInsensitive) != nil {
                return "Refund under the 14-day cooling-off"
            }
            return "Refund: \(right)"
        case .replace: return "Replacement under the Consumer Rights Act"
        case .repair: return "Repair under the Consumer Rights Act"
        case .none: return right
        }
    }
}
