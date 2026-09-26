import Foundation

/// Map a live offer onto the shortlist row the judge and pound rule use.
func offerToItem(_ offer: Offer, index: Int) -> ShortlistItem {
    let pence = offer.pricePence ?? parsePricePence(offer.price)
    let id: String
    if let offerId = offer.offerId {
        id = "sponsored-\(offerId)"
    } else {
        id = "\(offer.section.rawValue)-\(index + 1)"
    }
    let section: ReceiptSection
    switch offer.section {
    case .sponsored:
        section = .sponsored
    case .browse:
        section = .browse
    }
    return ShortlistItem(
        id: id,
        title: offer.title,
        pricePence: pence,
        priceLabel: offer.price,
        merchant: offer.merchant,
        delivery: offer.delivery,
        returns: offer.returns,
        rating: offer.rating,
        ratingCount: offer.ratingCount,
        section: section,
        badge: offer.badge,
        venueHint: offer.merchantDomain,
        sellerTypeHint: nil,
        imageUrls: offer.imageUrls ?? [],
        imageUrl: offer.imageUrl,
        imageDataUrl: offer.imageDataUrl,
        productUrl: offer.productUrl,
        raw: .offer(offer)
    )
}

extension DecideResponse {
    /// Every offer the server judged — never only the shortlist.
    var allRows: [ShortlistItem] {
        if let listings, !listings.isEmpty { return listings }
        if let offers, !offers.isEmpty {
            return offers.enumerated().map { offerToItem($1, index: $0) }
        }
        return shortlist
    }
}

extension ShortlistItem {
    func chosenPayload() -> ChosenItem {
        if let raw {
            switch raw {
            case .offer(let offer):
                return .offer(offer)
            case .listing(let listing):
                return .listing(listing)
            }
        }
        return .offer(
            Offer(
                section: section == .sponsored ? .sponsored : .browse,
                position: nil,
                title: title,
                price: priceLabel,
                pricePence: pricePence,
                compareAt: nil,
                merchant: merchant,
                merchantDomain: venueHint,
                merchantId: nil,
                offerId: nil,
                offerDocid: nil,
                location: nil,
                badge: badge,
                delivery: delivery,
                returns: returns,
                energy: nil,
                rating: rating,
                ratingCount: ratingCount,
                specs: nil,
                productUrl: productUrl,
                moreMerchants: nil,
                summary: nil,
                imageUrls: imageUrls,
                imageUrl: imageUrl,
                imageDataUrl: imageDataUrl
            )
        )
    }
}

func isFleeceDemoQuery(_ query: String) -> Bool {
    query.lowercased().contains("fleece")
}

func resolveCoveredAssetURL(_ raw: String?) -> URL? {
    guard let raw, !raw.isEmpty else { return nil }
    if raw.hasPrefix("http://") || raw.hasPrefix("https://") {
        return URL(string: raw)
    }
    return URL(string: raw, relativeTo: APIClient.resolvedBaseURL())?.absoluteURL
}

enum DataURLImage {
    static func decode(_ dataURL: String?) -> Data? {
        guard let dataURL, !dataURL.isEmpty else { return nil }
        let payload: String
        if let comma = dataURL.firstIndex(of: ",") {
            payload = String(dataURL[dataURL.index(after: comma)...])
        } else {
            payload = dataURL
        }
        return Data(base64Encoded: payload, options: [.ignoreUnknownCharacters])
    }
}

extension ReaderError.Kind {
    var plainEnglish: String {
        switch self {
        case .challenge:
            return "Google asked the laptop to prove it's you. Try again from Brave, or we can use a saved snapshot."
        case .timeout:
            return "The search timed out."
        case .noOffers:
            return "Nothing on the shelf for that search."
        case .unknown:
            return "The reader could not finish."
        }
    }
}

func plainSearchError(_ error: APIError) -> String {
    switch error {
    case .reader(let reader):
        let kind = reader.kind.plainEnglish
        if reader.message.isEmpty { return kind }
        return "\(kind) \(reader.message)"
    case .http(let status, let message):
        if status == 404 { return message.isEmpty ? "That route is not on the server yet." : message }
        if message.hasPrefix("[") || message.contains("invalid_type") || message.contains("invalid_value") {
            return "The server could not judge those listings. Try again."
        }
        return message.isEmpty ? "Request failed (\(status))." : message
    case .walletShort(let message), .decoding(let message), .transport(let message), .unexpected(let message):
        return message
    }
}
