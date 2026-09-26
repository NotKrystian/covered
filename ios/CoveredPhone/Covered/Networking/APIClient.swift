// One URLSession with a persistent cookie jar. The server identifies the buyer
// by the anonymous httpOnly `covered_uid` cookie it sets; the phone stores
// nothing else about identity. Base URL is a debug setting.
import Foundation

enum APIError: LocalizedError {
    case network(String)
    case http(status: Int, message: String)
    case walletShort(String)
    case reader(ReaderError)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .network(let message): return "Network: \(message)"
        case .http(let status, let message): return message.isEmpty ? "Server returned \(status)" : message
        case .walletShort(let message): return message
        case .reader(let error): return "\(error.kind.rawValue): \(error.message)"
        case .decoding(let message): return "Could not read the server's reply (\(message))"
        }
    }

    var message: String { errorDescription ?? "Something broke." }
}

private struct AnyEncodable: Encodable {
    let value: any Encodable
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}

private struct ServerErrorEnvelope: Decodable {
    var ok: Bool?
    var error: String?
}

final class CoveredAPI: @unchecked Sendable {
    static let shared = CoveredAPI()

    static let defaultBase = "https://covered.kawuc.uk"
    static let localBase = "http://localhost:3000"
    private static let baseKey = "covered_base_url"

    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    var baseURLString: String {
        get { UserDefaults.standard.string(forKey: Self.baseKey) ?? Self.defaultBase }
        set {
            let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
            UserDefaults.standard.set(trimmed.isEmpty ? Self.defaultBase : trimmed, forKey: Self.baseKey)
        }
    }

    var baseURL: URL {
        URL(string: baseURLString) ?? URL(string: Self.defaultBase)!
    }

    private init() {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.timeoutIntervalForRequest = 120
        config.timeoutIntervalForResource = 180
        config.waitsForConnectivity = true
        session = URLSession(configuration: config)
    }

    // MARK: Transport

    struct Raw {
        let status: Int
        let data: Data
    }

    private func url(_ path: String, query: [URLQueryItem]) -> URL? {
        var base = baseURL.absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        var components = URLComponents(string: base + path)
        if !query.isEmpty { components?.queryItems = query }
        return components?.url
    }

    func send(_ method: String, _ path: String, query: [URLQueryItem] = [], body: (any Encodable)? = nil) async throws -> Raw {
        guard let url = url(path, query: query) else { throw APIError.network("bad base URL") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try encoder.encode(AnyEncodable(value: body))
        }
        do {
            let (data, response) = try await session.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            return Raw(status: status, data: data)
        } catch let error as URLError {
            throw APIError.network(error.localizedDescription)
        }
    }

    func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error).prefix(200).description)
        }
    }

    private func serverMessage(_ raw: Raw) -> String {
        (try? decoder.decode(ServerErrorEnvelope.self, from: raw.data))?.error ?? ""
    }

    /// Decode a 2xx body, or throw the server's `error` line.
    private func expect<T: Decodable>(_ type: T.Type, _ raw: Raw) throws -> T {
        guard (200..<300).contains(raw.status) else {
            throw APIError.http(status: raw.status, message: serverMessage(raw))
        }
        return try decode(T.self, from: raw.data)
    }

    // MARK: Memory

    struct MemoryResponse: Decodable {
        var ok: Bool
        var memory: Memory
        var store: String
    }

    func memory() async throws -> MemoryResponse {
        try expect(MemoryResponse.self, await send("GET", "/api/memory"))
    }

    struct MemoryPatch: Encodable {
        var displayName: String?
        var settings: UserSettings?
        var onboarded: Bool?

        enum CodingKeys: String, CodingKey {
            case displayName = "display_name"
            case settings, onboarded
        }
    }

    func patchMemory(_ patch: MemoryPatch) async throws -> MemoryResponse {
        try expect(MemoryResponse.self, await send("PATCH", "/api/memory", body: patch))
    }

    /// Reset memory: removes the item and drops the cookie. The next call mints a fresh uid.
    func resetMemory() async throws {
        let raw = try await send("DELETE", "/api/memory")
        guard (200..<300).contains(raw.status) else {
            throw APIError.http(status: raw.status, message: serverMessage(raw))
        }
        // The server clears the cookie; drop any local copy too so the next request starts clean.
        if let cookies = HTTPCookieStorage.shared.cookies(for: baseURL) {
            for cookie in cookies where cookie.name == "covered_uid" || cookie.name == "covered_onboarded" {
                HTTPCookieStorage.shared.deleteCookie(cookie)
            }
        }
    }

    // MARK: Wallet

    struct WalletResponse: Decodable {
        var ok: Bool
        var balancePence: Int
        var deposits: [Deposit]
        var store: String?

        enum CodingKeys: String, CodingKey {
            case ok
            case balancePence = "balance_pence"
            case deposits, store
        }
    }

    func wallet() async throws -> WalletResponse {
        try expect(WalletResponse.self, await send("GET", "/api/wallet"))
    }

    private struct DepositBody: Encodable {
        var amountPence: Int
        enum CodingKeys: String, CodingKey { case amountPence = "amount_pence" }
    }

    func deposit(pence: Int) async throws -> WalletResponse {
        try expect(WalletResponse.self, await send("POST", "/api/wallet", body: DepositBody(amountPence: pence)))
    }

    // MARK: Reader + judge

    private struct SearchBody: Encodable {
        var query: String
    }

    private struct ReaderEnvelope: Decodable {
        var ok: Bool
        var result: SearchResult?
        var error: ReaderError?
    }

    /// Server-side read of the grid. Throws `.reader` with the typed kind when Google challenged.
    func search(query: String) async throws -> SearchResult {
        let raw = try await send("POST", "/api/search", body: SearchBody(query: query))
        let envelope = try decode(ReaderEnvelope.self, from: raw.data)
        if envelope.ok, let result = envelope.result {
            if result.offers.isEmpty {
                throw APIError.reader(ReaderError(kind: .noOffers, message: "grid was empty"))
            }
            return result
        }
        throw APIError.reader(envelope.error ?? ReaderError(kind: .unknown, message: "unexpected reader response (\(raw.status))"))
    }

    private struct GridBody: Encodable {
        var source: SearchSource
        var fetchedAt: String
        var note: String?
        var fallbackFrom: ReaderError?

        enum CodingKeys: String, CodingKey {
            case source
            case fetchedAt = "fetched_at"
            case note
            case fallbackFrom = "fallback_from"
        }
    }

    private struct DecideBody: Encodable {
        var query: String
        var settings: UserSettings
        var displayName: String?
        var source: String?
        var offers: [Offer]?
        var grid: GridBody?

        enum CodingKeys: String, CodingKey {
            case query, settings
            case displayName = "display_name"
            case source, offers, grid
        }
    }

    /// The four seeded fleece listings. Always works.
    func decideFixtures(query: String, settings: UserSettings, displayName: String?) async throws -> DecideResponse {
        let body = DecideBody(query: query, settings: settings, displayName: displayName, source: "fixture", offers: nil, grid: nil)
        return try expect(DecideResponse.self, await send("POST", "/api/decide", body: body))
    }

    /// Judge offers that came back from `/api/search`.
    func decide(query: String, settings: UserSettings, displayName: String?, read: SearchResult) async throws -> DecideResponse {
        let grid = GridBody(source: read.source, fetchedAt: read.fetchedAt, note: read.note, fallbackFrom: read.fallbackFrom)
        let body = DecideBody(query: query, settings: settings, displayName: displayName, source: nil, offers: read.offers, grid: grid)
        return try expect(DecideResponse.self, await send("POST", "/api/decide", body: body))
    }

    // MARK: Approve

    struct ApproveBody: Encodable {
        var query: String
        var chosen: ChosenPayload
        var decision: Decision
        var section: ReceiptSection
        var protectionPremiumPence: Int
        var chosenId: String

        enum CodingKeys: String, CodingKey {
            case query, chosen, decision, section
            case protectionPremiumPence = "protection_premium_pence"
            case chosenId = "chosen_id"
        }
    }

    struct ApproveResponse: Decodable {
        var ok: Bool
        var id: String?
        var key: String?
        var balancePence: Int?
        var error: String?

        enum CodingKeys: String, CodingKey {
            case ok, id, key
            case balancePence = "balance_pence"
            case error
        }
    }

    /// Debits the wallet and writes the receipt. 402 → `.walletShort`.
    func approve(_ body: ApproveBody) async throws -> ApproveResponse {
        let raw = try await send("POST", "/api/approve", body: body)
        if raw.status == 402 {
            let message = serverMessage(raw)
            throw APIError.walletShort(message.isEmpty ? "Wallet is short." : message)
        }
        let response = try expect(ApproveResponse.self, raw)
        guard response.ok, response.id != nil else {
            throw APIError.http(status: raw.status, message: response.error ?? "Approve failed.")
        }
        return response
    }

    // MARK: Orders

    struct OrdersResponse: Decodable {
        var orders: [OrderRecord]
        var totalPence: Int
        var count: Int

        enum CodingKeys: String, CodingKey {
            case orders
            case totalPence = "total_pence"
            case count
        }
    }

    func orders() async throws -> OrdersResponse {
        try expect(OrdersResponse.self, await send("GET", "/api/orders"))
    }

    private struct AssistBody: Encodable {
        var orderId: String
        var message: String
        var history: [AftercareTurn]

        enum CodingKeys: String, CodingKey {
            case orderId = "order_id"
            case message, history
        }
    }

    /// Drafts a returns / fault letter. Never emails the merchant.
    func assist(orderId: String, message: String, history: [AftercareTurn]) async throws -> AftercareAssist {
        try expect(AftercareAssist.self, await send("POST", "/api/orders/assist", body: AssistBody(orderId: orderId, message: message, history: history)))
    }

    // MARK: Limits

    struct LimitsResponse: Decodable {
        var ok: Bool
        var limits: [Limit]?
        var error: String?
    }

    private func limitsOrThrow(_ raw: Raw) throws -> [Limit] {
        let response = try expect(LimitsResponse.self, raw)
        guard response.ok, let limits = response.limits else {
            throw APIError.http(status: raw.status, message: response.error ?? "Limits failed.")
        }
        return limits
    }

    func limits() async throws -> [Limit] {
        try limitsOrThrow(await send("GET", "/api/limits"))
    }

    private struct LimitBody: Encodable {
        var query: String
        var maxPricePence: Int
        enum CodingKeys: String, CodingKey {
            case query
            case maxPricePence = "max_price_pence"
        }
    }

    func createLimit(query: String, maxPricePence: Int) async throws -> [Limit] {
        try limitsOrThrow(await send("POST", "/api/limits", body: LimitBody(query: query, maxPricePence: maxPricePence)))
    }

    func deleteLimit(id: String) async throws -> [Limit] {
        try limitsOrThrow(await send("DELETE", "/api/limits", query: [URLQueryItem(name: "id", value: id)]))
    }

    // MARK: Photos

    private static let proxyHosts = ["gstatic.com", "googleusercontent.com"]

    /// Where to load a row's photo from: an embedded jpeg, a same-origin fixture,
    /// the server image proxy for Google thumbs, or the shop CDN.
    func photoSource(for item: ShortlistItem) -> PhotoSource {
        if let dataUrl = item.imageDataUrl, let data = PhotoSource.decodeDataURL(dataUrl) {
            return .data(data)
        }
        for candidate in [item.imageUrl, item.imageUrls.first] {
            guard let candidate, !candidate.isEmpty else { continue }
            if candidate.hasPrefix("/"), !candidate.hasPrefix("//") {
                if let url = url(candidate, query: []) { return .remote(url) }
                continue
            }
            guard let url = URL(string: candidate), url.scheme == "https", let host = url.host else { continue }
            if Self.proxyHosts.contains(where: { host == $0 || host.hasSuffix("." + $0) }) {
                if let proxied = self.url("/api/image", query: [URLQueryItem(name: "url", value: candidate)]) {
                    return .remote(proxied)
                }
                continue
            }
            return .remote(url)
        }
        return .none
    }
}

enum PhotoSource {
    case data(Data)
    case remote(URL)
    case none

    static func decodeDataURL(_ text: String) -> Data? {
        guard text.hasPrefix("data:image/"), let comma = text.firstIndex(of: ",") else { return nil }
        let header = text[text.startIndex..<comma]
        guard header.contains(";base64") else { return nil }
        return Data(base64Encoded: String(text[text.index(after: comma)...]), options: .ignoreUnknownCharacters)
    }
}
