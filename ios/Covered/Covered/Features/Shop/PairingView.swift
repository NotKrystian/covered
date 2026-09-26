import SwiftUI

/// Pair this iPhone with the laptop Brave reader via a 6-character code.
struct PairingView: View {
    var embedded = false

    @State private var code = ""
    @State private var status: ClaimStatus = .idle
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: embedded ? 16 : Theme.padLarge) {
            if !embedded {
                Text("Pair with your laptop")
                    .font(.ui(28, weight: .semibold))
                    .foregroundStyle(Color.ink)
            }

            Text("Searches run in your Brave on the laptop.")
                .font(.ui(16))
                .foregroundStyle(Color.muted)

            codeField

            Button {
                Task { await claim() }
            } label: {
                Text(status == .claiming ? "Claiming…" : "Claim")
                    .font(.ui(17, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .foregroundStyle(Color.ink)
                    .background(
                        Color.accent,
                        in: RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous)
                    )
            }
            .disabled(!canClaim)
            .opacity(canClaim ? 1 : 0.45)
            .animation(.spring(response: 0.35, dampingFraction: 0.9), value: canClaim)
            .accessibilityIdentifier("pairing.claim")

            resultLine
            if !embedded {
                Spacer()
            }
        }
        .padding(embedded ? 0 : Theme.padLarge)
        .frame(maxWidth: .infinity, maxHeight: embedded ? nil : .infinity, alignment: .topLeading)
        .background {
            if !embedded {
                Color.canvas.ignoresSafeArea()
            }
        }
        .navigationTitle("Pair")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { focused = true }
    }

    private var canClaim: Bool {
        PairingCode.normalize(code).count == 6 && status != .claiming
    }

    private var codeField: some View {
        TextField("ABC123", text: $code)
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
            .keyboardType(.asciiCapable)
            .textContentType(.oneTimeCode)
            .font(.system(size: 32, weight: .semibold, design: .monospaced))
            .monospacedDigit()
            .multilineTextAlignment(.center)
            .focused($focused)
            .padding(.vertical, 18)
            .foregroundStyle(Color.canvas)
            .background(
                RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                    .fill(Color.ink)
            )
            .onChange(of: code) { _, next in
                let clipped = String(PairingCode.normalize(next).prefix(6))
                if clipped != next { code = clipped }
            }
            .accessibilityLabel("Pairing code")
            .accessibilityIdentifier("pairing.code")
    }

    @ViewBuilder
    private var resultLine: some View {
        switch status {
        case .idle, .claiming:
            EmptyView()
        case .success:
            Text("Paired. This phone now uses the same Covered buyer as your laptop.")
                .font(.ui(15))
                .foregroundStyle(Color.accent)
                .transition(.blurReplace)
        case .failure(let message):
            Text(message)
                .font(.ui(15))
                .foregroundStyle(Color.muted)
                .transition(.blurReplace)
                .accessibilityIdentifier("pairing.error")
        }
    }

    @MainActor
    private func claim() async {
        let value = PairingCode.normalize(code)
        guard value.count == 6 else { return }
        status = .claiming
        do {
            let claimed = try await AppState.shared.api.claimPair(code: value)
            Haptics.success()
            withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) {
                status = .success(userId: claimed.userId)
            }
            await AppState.shared.refresh()
        } catch let error as APIError {
            Haptics.light()
            withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) {
                status = .failure(PairingCode.plainError(error))
            }
        } catch {
            Haptics.light()
            withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) {
                status = .failure(error.localizedDescription)
            }
        }
    }
}

enum ClaimStatus: Equatable {
    case idle
    case claiming
    case success(userId: String?)
    case failure(String)
}

enum PairingCode {
    static func normalize(_ raw: String) -> String {
        raw.uppercased().filter { $0.isLetter || $0.isNumber }
    }

    static func plainError(_ error: APIError) -> String {
        switch error {
        case .http(let status, let message):
            if status == 404 {
                return "Pairing isn't live on the server yet"
            }
            if status == 410 {
                return message.isEmpty ? "That code has expired or already been used." : message
            }
            return message.isEmpty ? "Could not pair (\(status))." : message
        case .walletShort(let message), .decoding(let message), .transport(let message), .unexpected(let message):
            return message
        case .reader(let error):
            return error.message
        }
    }
}
