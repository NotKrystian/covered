import Foundation

enum APIError: Error, LocalizedError, Equatable {
    case http(status: Int, message: String)
    case walletShort(message: String)
    case decoding(message: String)
    case transport(message: String)
    case reader(ReaderError)
    case unexpected(message: String)

    var errorDescription: String? {
        switch self {
        case .http(_, let message):
            return message
        case .walletShort(let message):
            return message
        case .decoding(let message):
            return message
        case .transport(let message):
            return message
        case .reader(let error):
            return "\(error.kind.rawValue): \(error.message)"
        case .unexpected(let message):
            return message
        }
    }
}

extension JSONDecoder {
    static var covered: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}

extension JSONEncoder {
    static var covered: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return encoder
    }
}

actor APIClient {
    static let defaultBaseURL = URL(string: "https://covered.kawuc.uk")!
    static let baseURLDefaultsKey = "covered.baseURL"

    /// When set, every request uses this host. Otherwise the Settings value is read live.
    private let pinnedBaseURL: URL?
    private let session: URLSession
    private let decoder = JSONDecoder.covered
    private let encoder = JSONEncoder.covered

    var baseURL: URL {
        pinnedBaseURL ?? Self.resolvedBaseURL()
    }

    nonisolated static func resolvedBaseURL() -> URL {
        if let raw = UserDefaults.standard.string(forKey: baseURLDefaultsKey),
           let url = URL(string: raw), !raw.isEmpty {
            return url
        }
        return defaultBaseURL
    }

    init(baseURL: URL? = nil, session: URLSession? = nil) {
        self.pinnedBaseURL = baseURL

        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.httpCookieStorage = HTTPCookieStorage.shared
            config.httpShouldSetCookies = true
            config.httpCookieAcceptPolicy = .always
            config.timeoutIntervalForRequest = 120
            config.timeoutIntervalForResource = 180
            HTTPCookieStorage.shared.cookieAcceptPolicy = .always
            self.session = URLSession(configuration: config)
        }
    }

    // MARK: - Decide / search

    func decide(
        query: String,
        settings: UserSettings? = nil,
        source: SearchSource? = nil,
        offers: [Offer]? = nil,
        fetchedAt: String? = nil
    ) async throws -> DecideResponse {
        struct GridMeta: Encodable {
            var source: SearchSource
            var fetchedAt: String
        }
        struct Body: Encodable {
            var query: String
            var settings: UserSettings?
            var source: String?
            var offers: [Offer]?
            var grid: GridMeta?
        }
        let useFixtures = offers == nil && (source == nil || source == .fixture)
        let body = Body(
            query: query,
            settings: settings,
            source: useFixtures ? "fixture" : nil,
            offers: offers,
            grid: useFixtures ? nil : GridMeta(
                source: source ?? .live,
                fetchedAt: fetchedAt ?? ISO8601DateFormatter().string(from: Date())
            )
        )
        return try await send("POST", "/api/decide", body: body)
    }

    func search(query: String) async throws -> SearchResult {
        struct Body: Encodable { var query: String }
        let response: ReaderResponse = try await send("POST", "/api/search", body: Body(query: query))
        if response.ok, let result = response.result {
            return result
        }
        if let error = response.error {
            throw APIError.reader(error)
        }
        throw APIError.unexpected(message: "empty search response")
    }

    // MARK: - Approve / wallet / orders

    func approve(receipt: Receipt) async throws -> ApproveResponse {
        let response: ApproveResponse
        let status: Int
        (response, status) = try await sendRaw("POST", "/api/approve", body: receipt)
        if status == 402 {
            throw APIError.walletShort(message: response.error ?? "Wallet is short.")
        }
        if status >= 400 || response.ok != true {
            throw APIError.http(status: status, message: response.error ?? "Approve failed (\(status)).")
        }
        return response
    }

    func wallet() async throws -> Wallet {
        try await send("GET", "/api/wallet")
    }

    func deposit(pence: Int) async throws -> Wallet {
        struct Body: Encodable { var amountPence: Int }
        return try await send("POST", "/api/wallet", body: Body(amountPence: pence))
    }

    func orders() async throws -> [Order] {
        let response: OrdersResponse = try await send("GET", "/api/orders")
        return response.orders
    }

    func assist(orderId: String?, message: String, history: [AssistHistoryTurn] = []) async throws -> AssistResponse {
        struct Body: Encodable {
            var orderId: String?
            var message: String
            var history: [AssistHistoryTurn]
        }
        return try await send(
            "POST",
            "/api/orders/assist",
            body: Body(orderId: orderId, message: message, history: history)
        )
    }

    // MARK: - Limits / memory / settings

    func limits() async throws -> [Limit] {
        let response: LimitsResponse = try await send("GET", "/api/limits")
        return response.limits ?? []
    }

    func createLimit(query: String, maxPence: Int) async throws -> [Limit] {
        struct Body: Encodable {
            var query: String
            var maxPricePence: Int
        }
        let response: LimitsResponse = try await send(
            "POST",
            "/api/limits",
            body: Body(query: query, maxPricePence: maxPence)
        )
        if response.ok == false {
            throw APIError.unexpected(message: response.error ?? "Could not save the limit")
        }
        return response.limits ?? []
    }

    func deleteLimit(id: String) async throws -> [Limit] {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? id
        let response: LimitsResponse = try await send("DELETE", "/api/limits?id=\(encoded)")
        if response.ok == false {
            throw APIError.unexpected(message: response.error ?? "Could not remove the limit")
        }
        return response.limits ?? []
    }

    func memory() async throws -> Memory {
        let response: MemoryResponse = try await send("GET", "/api/memory")
        guard let memory = response.memory else {
            throw APIError.unexpected(message: response.error ?? "No memory returned")
        }
        return memory
    }

    func resetMemory() async throws {
        struct Ok: Decodable { var ok: Bool? }
        _ = try await send("DELETE", "/api/memory") as Ok
    }

    /// PATCH /api/memory — same path the web onboarding uses (`patchMemory`).
    func saveSettings(
        displayName: String? = nil,
        settings: UserSettings? = nil,
        onboarded: Bool? = nil
    ) async throws -> Memory {
        struct Body: Encodable {
            var displayName: String?
            var settings: UserSettings?
            var onboarded: Bool?
        }
        let response: MemoryResponse = try await send(
            "PATCH",
            "/api/memory",
            body: Body(displayName: displayName, settings: settings, onboarded: onboarded)
        )
        guard let memory = response.memory else {
            throw APIError.unexpected(message: response.error ?? "Could not save settings")
        }
        return memory
    }

    // MARK: - JSON helpers

    func switchWatches() async throws -> [SwitchWatch] {
        let response: SwitchWatchesResponse = try await send("GET", "/api/switch")
        if response.ok == false {
            throw APIError.unexpected(message: response.error ?? "Could not load the switch window")
        }
        return response.watches ?? []
    }

    func runSwitch(orderId: String, offers: [Offer]) async throws -> SwitchRunResponse {
        struct Body: Encodable {
            var orderId: String
            var offers: [Offer]
        }
        let (response, status): (SwitchRunResponse, Int) = try await sendRaw(
            "POST",
            "/api/switch/run",
            body: Body(orderId: orderId, offers: offers)
        )
        if status >= 400 || response.ok != true {
            throw APIError.http(status: status, message: response.error ?? "Switch check failed (\(status)).")
        }
        return response
    }

    func simulateSwitch(orderId: String) async throws -> SwitchRunResponse {
        struct Body: Encodable { var orderId: String }
        let (response, status): (SwitchRunResponse, Int) = try await sendRaw(
            "POST",
            "/api/switch/simulate",
            body: Body(orderId: orderId)
        )
        if status >= 400 || response.ok != true {
            throw APIError.http(status: status, message: response.error ?? "Simulation failed (\(status)).")
        }
        return response
    }

    func acceptSwitch(orderId: String) async throws -> SwitchAcceptResponse {
        struct Body: Encodable { var orderId: String }
        let (response, status): (SwitchAcceptResponse, Int) = try await sendRaw(
            "POST",
            "/api/switch/accept",
            body: Body(orderId: orderId)
        )
        if status == 402 {
            throw APIError.walletShort(message: response.error ?? "Wallet is short.")
        }
        if status >= 400 || response.ok != true {
            throw APIError.http(status: status, message: response.error ?? "Switch failed (\(status)).")
        }
        return response
    }

    func send<T: Decodable>(_ method: String, _ path: String, body: (any Encodable)? = nil) async throws -> T {
        let (decoded, status): (T, Int) = try await sendRaw(method, path, body: body)
        if status >= 400 {
            throw APIError.http(status: status, message: "Request failed (\(status)).")
        }
        return decoded
    }

    func sendRaw<T: Decodable>(
        _ method: String,
        _ path: String,
        body: (any Encodable)?
    ) async throws -> (T, Int) {
        let data: Data
        let response: HTTPURLResponse
        (data, response) = try await perform(method, path, body: body)
        if response.statusCode == 401 {
            if let err = try? decoder.decode(ServerErrorBody.self, from: data) {
                let token = (err.error ?? err.message ?? "").lowercased()
                if token.contains("invalid_token") {
                    KeychainToken.clear()
                    throw APIError.http(status: 401, message: "Pair again — that token is no longer valid.")
                }
            }
        }
        if response.statusCode == 404 {
            if let err = try? decoder.decode(ServerErrorBody.self, from: data) {
                let message = err.error ?? err.message ?? ""
                if T.self == PairClaim.self || T.self == SwitchRunResponse.self || T.self == SwitchAcceptResponse.self {
                    // Caller maps JSON 404 (unknown pair code / missing order).
                } else if !message.isEmpty {
                    throw APIError.http(status: 404, message: message)
                }
            } else if !Self.looksLikeJSON(data) {
                throw APIError.http(status: 404, message: "route_missing")
            }
        }
        if response.statusCode >= 400 {
            if let err = try? decoder.decode(ServerErrorBody.self, from: data),
               let message = err.error ?? err.message,
               !message.isEmpty {
                if T.self == ApproveResponse.self
                    || T.self == MemoryResponse.self
                    || T.self == LimitsResponse.self
                    || T.self == PairClaim.self
                    || T.self == SwitchRunResponse.self
                    || T.self == SwitchAcceptResponse.self
                    || T.self == ReaderJobCreateResponse.self
                    || T.self == SwitchWatchesResponse.self {
                    // Fall through and let the caller inspect the typed body.
                } else {
                    throw APIError.http(status: response.statusCode, message: message)
                }
            }
        }
        do {
            return (try decoder.decode(T.self, from: data), response.statusCode)
        } catch {
            if let err = try? decoder.decode(ServerErrorBody.self, from: data),
               let message = err.error ?? err.message {
                throw APIError.http(status: response.statusCode, message: message)
            }
            throw APIError.decoding(message: error.localizedDescription)
        }
    }

    private func perform(
        _ method: String,
        _ path: String,
        body: (any Encodable)?
    ) async throws -> (Data, HTTPURLResponse) {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIError.unexpected(message: "Bad path \(path)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = KeychainToken.bearerToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            do {
                request.httpBody = try encoder.encode(AnyEncodable(body))
            } catch {
                throw APIError.unexpected(message: "Could not encode body")
            }
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(message: error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.unexpected(message: "Not an HTTP response")
        }
        return (data, http)
    }

    nonisolated static func looksLikeJSON(_ data: Data) -> Bool {
        guard let first = data.first(where: { !($0 == 9 || $0 == 10 || $0 == 13 || $0 == 32) }) else {
            return false
        }
        return first == 123 || first == 91
    }
}

private struct AnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void

    init(_ value: any Encodable) {
        encodeClosure = { encoder in
            try value.encode(to: encoder)
        }
    }

    func encode(to encoder: Encoder) throws {
        try encodeClosure(encoder)
    }
}
