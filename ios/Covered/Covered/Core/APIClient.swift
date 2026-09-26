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

    let baseURL: URL
    private let session: URLSession
    private let decoder = JSONDecoder.covered
    private let encoder = JSONEncoder.covered

    init(baseURL: URL? = nil, session: URLSession? = nil) {
        if let baseURL {
            self.baseURL = baseURL
        } else if let raw = UserDefaults.standard.string(forKey: Self.baseURLDefaultsKey),
                  let url = URL(string: raw), !raw.isEmpty {
            self.baseURL = url
        } else {
            self.baseURL = Self.defaultBaseURL
        }

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
        offers: [Offer]? = nil
    ) async throws -> DecideResponse {
        struct Body: Encodable {
            var query: String
            var settings: UserSettings?
            var source: SearchSource?
            var offers: [Offer]?
        }
        let body = Body(
            query: query,
            settings: settings,
            source: offers == nil ? (source ?? .fixture) : source,
            offers: offers
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

    private func send<T: Decodable>(_ method: String, _ path: String, body: (any Encodable)? = nil) async throws -> T {
        let (decoded, status): (T, Int) = try await sendRaw(method, path, body: body)
        if status >= 400 {
            throw APIError.http(status: status, message: "Request failed (\(status)).")
        }
        return decoded
    }

    private func sendRaw<T: Decodable>(
        _ method: String,
        _ path: String,
        body: (any Encodable)?
    ) async throws -> (T, Int) {
        let data: Data
        let response: HTTPURLResponse
        (data, response) = try await perform(method, path, body: body)
        if response.statusCode >= 400 {
            if let err = try? decoder.decode(ServerErrorBody.self, from: data),
               let message = err.error ?? err.message,
               !message.isEmpty {
                if T.self == ApproveResponse.self || T.self == MemoryResponse.self || T.self == LimitsResponse.self {
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
