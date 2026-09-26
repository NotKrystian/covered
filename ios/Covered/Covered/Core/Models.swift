import Foundation

// MARK: - Offers / search

enum OfferSection: String, Codable, Sendable, Hashable {
    case sponsored
    case browse
}

enum SearchSource: String, Codable, Sendable, Hashable {
    case live
    case fixture
    case snapshot
}

enum ReceiptSection: String, Codable, Sendable, Hashable {
    case sponsored
    case browse
    case fixture
}

struct Offer: Codable, Sendable, Hashable {
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
        case section, position, title, price, pricePence, compareAt, merchant
        case merchantDomain, merchantId, offerId, offerDocid, location
        case badge, delivery, returns, energy, rating, ratingCount
        case specs, productUrl, moreMerchants, summary
        case imageUrls, imageUrl, imageDataUrl
    }

    /// Server zod requires `compare_at`, `badge`, `delivery`, `rating`, and `rating_count`
    /// as `string | null`. Swift's default encoder omits nil optionals, which fails as undefined.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(section, forKey: .section)
        try container.encodeIfPresent(position, forKey: .position)
        try container.encode(title, forKey: .title)
        try container.encode(price, forKey: .price)
        try container.encodeIfPresent(pricePence, forKey: .pricePence)
        try container.encode(compareAt, forKey: .compareAt)
        try container.encode(merchant, forKey: .merchant)
        try container.encodeIfPresent(merchantDomain, forKey: .merchantDomain)
        try container.encodeIfPresent(merchantId, forKey: .merchantId)
        try container.encodeIfPresent(offerId, forKey: .offerId)
        try container.encodeIfPresent(offerDocid, forKey: .offerDocid)
        try container.encode(location, forKey: .location)
        try container.encode(badge, forKey: .badge)
        try container.encode(delivery, forKey: .delivery)
        try container.encode(returns, forKey: .returns)
        try container.encode(energy, forKey: .energy)
        try container.encode(rating, forKey: .rating)
        try container.encode(ratingCount, forKey: .ratingCount)
        try container.encodeIfPresent(specs, forKey: .specs)
        try container.encodeIfPresent(productUrl, forKey: .productUrl)
        try container.encode(moreMerchants, forKey: .moreMerchants)
        try container.encode(summary, forKey: .summary)
        try container.encodeIfPresent(imageUrls, forKey: .imageUrls)
        try container.encode(imageUrl, forKey: .imageUrl)
        try container.encode(imageDataUrl, forKey: .imageDataUrl)
    }
}

struct Listing: Codable, Sendable, Hashable, Identifiable {
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
}

struct ReaderError: Codable, Sendable, Hashable, Error {
    enum Kind: String, Codable, Sendable, Hashable {
        case challenge
        case timeout
        case noOffers = "no_offers"
        case unknown
    }

    var kind: Kind
    var message: String
}

struct SearchResult: Codable, Sendable, Hashable {
    var query: String
    var fetchedAt: String
    var source: SearchSource
    var offers: [Offer]
    var note: String?
    var fallbackFrom: ReaderError?
}

struct ReaderResponse: Codable, Sendable {
    var ok: Bool
    var result: SearchResult?
    var error: ReaderError?
}

// MARK: - Judge

enum SellerType: String, Codable, Sendable, Hashable {
    case ukBusiness = "uk_business"
    case privateSeller = "private"
    case overseasBusiness = "overseas_business"
    case unclear
}

enum VenueTrust: String, Codable, Sendable, Hashable {
    case shopCheckout = "shop_checkout"
    case marketplaceProtected = "marketplace_protected"
    case marketplaceUnprotected = "marketplace_unprotected"
    case stranger
    case unclear
}

enum Recommendation: String, Codable, Sendable, Hashable {
    case buy
    case skip
    case ask
}

enum JudgeMode: String, Codable, Sendable, Hashable {
    case bedrock
    case mock
}

struct Decision: Codable, Sendable, Hashable {
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
        case sameItem, mislisting, photoReason, sponsored
        case sellerType, venueTrust, rights, recommendation, reason
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sameItem, forKey: .sameItem)
        try container.encode(mislisting, forKey: .mislisting)
        try container.encode(photoReason, forKey: .photoReason)
        try container.encode(sponsored, forKey: .sponsored)
        try container.encode(sellerType, forKey: .sellerType)
        try container.encode(venueTrust, forKey: .venueTrust)
        try container.encode(rights, forKey: .rights)
        try container.encode(recommendation, forKey: .recommendation)
        try container.encode(reason, forKey: .reason)
    }
}

struct Verdict: Codable, Sendable, Hashable {
    var chosenId: String?
    var perOffer: [String: Decision]
    var summary: String
}

struct TraceEvent: Codable, Sendable, Hashable {
    var t: String
    var tool: String
    var detail: String
}

enum ShortlistRaw: Codable, Sendable, Hashable {
    case offer(Offer)
    case listing(Listing)

    enum CodingKeys: String, CodingKey {
        case kind
        case offer
        case listing
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)
        switch kind {
        case "offer":
            self = .offer(try container.decode(Offer.self, forKey: .offer))
        case "listing":
            self = .listing(try container.decode(Listing.self, forKey: .listing))
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .kind,
                in: container,
                debugDescription: "unknown shortlist raw kind \(kind)"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .offer(let offer):
            try container.encode("offer", forKey: .kind)
            try container.encode(offer, forKey: .offer)
        case .listing(let listing):
            try container.encode("listing", forKey: .kind)
            try container.encode(listing, forKey: .listing)
        }
    }
}

struct ShortlistItem: Codable, Sendable, Hashable, Identifiable {
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
    var raw: ShortlistRaw?

    init(
        id: String,
        title: String,
        pricePence: Int?,
        priceLabel: String,
        merchant: String,
        delivery: String? = nil,
        returns: String? = nil,
        rating: String? = nil,
        ratingCount: String? = nil,
        section: ReceiptSection,
        badge: String? = nil,
        venueHint: String? = nil,
        sellerTypeHint: String? = nil,
        imageUrls: [String] = [],
        imageUrl: String? = nil,
        imageDataUrl: String? = nil,
        productUrl: String? = nil,
        raw: ShortlistRaw? = nil
    ) {
        self.id = id
        self.title = title
        self.pricePence = pricePence
        self.priceLabel = priceLabel
        self.merchant = merchant
        self.delivery = delivery
        self.returns = returns
        self.rating = rating
        self.ratingCount = ratingCount
        self.section = section
        self.badge = badge
        self.venueHint = venueHint
        self.sellerTypeHint = sellerTypeHint
        self.imageUrls = imageUrls
        self.imageUrl = imageUrl
        self.imageDataUrl = imageDataUrl
        self.productUrl = productUrl
        self.raw = raw
    }
}

struct DecideResponse: Codable, Sendable {
    var verdict: Verdict
    var decisions: [String: Decision]
    var shortlist: [ShortlistItem]
    var listings: [ShortlistItem]?
    var offers: [Offer]?
    var mode: JudgeMode?
    var model: String?
    var trace: [TraceEvent]
    var premiumPaidPence: Int?
    var learned: Bool?
    var briefBrand: String?
}

// MARK: - Receipt / wallet / orders

enum ChosenItem: Codable, Sendable, Hashable {
    case offer(Offer)
    case listing(Listing)

    init(from decoder: Decoder) throws {
        if let listing = try? Listing(from: decoder) {
            self = .listing(listing)
            return
        }
        self = .offer(try Offer(from: decoder))
    }

    func encode(to encoder: Encoder) throws {
        switch self {
        case .offer(let offer):
            try offer.encode(to: encoder)
        case .listing(let listing):
            try listing.encode(to: encoder)
        }
    }
}

struct Receipt: Codable, Sendable {
    var id: String?
    var createdAt: String?
    var query: String
    var chosen: ChosenItem
    var decision: Decision
    var section: ReceiptSection
    var protectionPremiumPence: Int
    var chosenId: String?
}

struct ApproveResponse: Codable, Sendable {
    var ok: Bool?
    var id: String?
    var key: String?
    var balancePence: Int?
    var error: String?
}

struct Deposit: Codable, Sendable, Hashable {
    var t: String
    var amountPence: Int
}

struct Wallet: Codable, Sendable {
    var balancePence: Int
    var deposits: [Deposit]
    var store: String?
    var ok: Bool?
}

enum AftercareRemedy: String, Codable, Sendable, Hashable {
    case refund
    case replace
    case repair
    case none
}

struct AftercareEntry: Codable, Sendable, Hashable {
    var t: String
    var remedy: AftercareRemedy
    var refused: Bool
    var note: String
}

struct SwitchOffer: Codable, Sendable, Hashable {
    var foundAt: String
    var simulated: Bool
    var chosenId: String
    var chosen: ChosenItem
    var decision: Decision
    var section: ReceiptSection
    var title: String
    var merchant: String
    var pricePence: Int
    var postagePence: Int
    var deliveryPence: Int
    var clearPence: Int
}

struct SwitchCheck: Codable, Sendable, Hashable {
    var checkedAt: String
    var note: String
    var offer: SwitchOffer?
}

struct Order: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var t: String
    var query: String
    var title: String
    var merchant: String
    var pricePence: Int
    var section: ReceiptSection
    var aftercare: [AftercareEntry]?
    var returns: String?
    var sellerType: SellerType?
    var switchCheck: SwitchCheck?
    var cancelledAt: String?
    var refundPence: Int?
    var switchedTo: String?
    var switchedFrom: String?

    var shortId: String {
        let trimmed = id.hasPrefix("#") ? String(id.dropFirst()) : id
        if trimmed.count <= 10 { return "#\(trimmed)" }
        return "#\(trimmed.suffix(6).uppercased())"
    }
}

struct SwitchWatch: Codable, Sendable, Hashable, Identifiable {
    var order: Order
    var endsAt: String
    var postagePence: Int
    var watching: Bool
    var blocked: String?

    var id: String { order.id }
}

struct SwitchWatchesResponse: Codable, Sendable {
    var ok: Bool?
    var watches: [SwitchWatch]?
    var error: String?
}

struct SwitchRunResponse: Codable, Sendable {
    var ok: Bool?
    var order: Order?
    var found: Bool?
    var error: String?
}

struct SwitchAcceptResponse: Codable, Sendable {
    var ok: Bool?
    var newOrderId: String?
    var refundPence: Int?
    var clearPence: Int?
    var balancePence: Int?
    var error: String?
}

struct OrdersResponse: Codable, Sendable {
    var orders: [Order]
    var totalPence: Int?
    var count: Int?
}

struct AssistHistoryTurn: Codable, Sendable, Hashable {
    var role: String
    var text: String
}

struct AssistResponse: Codable, Sendable {
    var reply: String
    var remedy: AftercareRemedy
    var right: String
    var draftToSeller: String?
    var refused: Bool
    var mode: JudgeMode?
    var orderId: String?
}

// MARK: - Limits / memory / settings

enum LimitStatus: String, Codable, Sendable, Hashable {
    case watching
    case filled
    case paused
}

struct Limit: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var query: String
    var maxPricePence: Int
    var status: LimitStatus
    var createdAt: String
    var lastCheckedAt: String
    var lastResult: String
    var filledOrderId: String?
}

struct LimitsResponse: Codable, Sendable {
    var ok: Bool?
    var limits: [Limit]?
    var error: String?
}

enum ApprovalMode: String, Codable, Sendable, Hashable {
    case ask
    case auto
}

struct UserSettings: Codable, Sendable, Hashable {
    var protectionPremiumPence: Int
    var switchMinimumPence: Int
    var approval: ApprovalMode

    static let defaults = UserSettings(
        protectionPremiumPence: 1000,
        switchMinimumPence: 800,
        approval: .ask
    )

    init(
        protectionPremiumPence: Int = 1000,
        switchMinimumPence: Int = 800,
        approval: ApprovalMode = .ask
    ) {
        self.protectionPremiumPence = protectionPremiumPence
        self.switchMinimumPence = switchMinimumPence
        self.approval = approval
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        protectionPremiumPence = try container.decodeIfPresent(Int.self, forKey: .protectionPremiumPence) ?? 1000
        switchMinimumPence = try container.decodeIfPresent(Int.self, forKey: .switchMinimumPence) ?? 800
        approval = try container.decodeIfPresent(ApprovalMode.self, forKey: .approval) ?? .ask
    }
}

enum MemoryEventKind: String, Codable, Sendable, Hashable {
    case decision
    case approve
    case override
}

struct MemoryEvent: Codable, Sendable, Hashable {
    var t: String
    var kind: MemoryEventKind
    var query: String
    var chosenId: String?
    var premiumPence: Int
    var note: String
}

struct Memory: Codable, Sendable {
    var userId: String?
    var displayName: String?
    var summary: String?
    var settings: UserSettings
    var events: [MemoryEvent]?
    var orders: [Order]?
    var balancePence: Int
    var deposits: [Deposit]?
    var limits: [Limit]?
    var onboarded: Bool
    var updatedAt: String?

    init(
        userId: String? = nil,
        displayName: String? = nil,
        summary: String? = nil,
        settings: UserSettings = .defaults,
        events: [MemoryEvent]? = nil,
        orders: [Order]? = nil,
        balancePence: Int = 0,
        deposits: [Deposit]? = nil,
        limits: [Limit]? = nil,
        onboarded: Bool = false,
        updatedAt: String? = nil
    ) {
        self.userId = userId
        self.displayName = displayName
        self.summary = summary
        self.settings = settings
        self.events = events
        self.orders = orders
        self.balancePence = balancePence
        self.deposits = deposits
        self.limits = limits
        self.onboarded = onboarded
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        userId = try container.decodeIfPresent(String.self, forKey: .userId)
        displayName = try container.decodeIfPresent(String.self, forKey: .displayName)
        summary = try container.decodeIfPresent(String.self, forKey: .summary)
        settings = try container.decodeIfPresent(UserSettings.self, forKey: .settings) ?? .defaults
        events = try container.decodeIfPresent([MemoryEvent].self, forKey: .events)
        orders = try container.decodeIfPresent([Order].self, forKey: .orders)
        balancePence = try container.decodeIfPresent(Int.self, forKey: .balancePence) ?? 0
        deposits = try container.decodeIfPresent([Deposit].self, forKey: .deposits)
        limits = try container.decodeIfPresent([Limit].self, forKey: .limits)
        onboarded = try container.decodeIfPresent(Bool.self, forKey: .onboarded) ?? false
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
    }
}

struct MemoryResponse: Codable, Sendable {
    var ok: Bool?
    var memory: Memory?
    var store: String?
    var summaryMode: String?
    var notes: [String]?
    var error: String?
}

struct ServerErrorBody: Codable, Sendable {
    var ok: Bool?
    var error: String?
    var message: String?
}
