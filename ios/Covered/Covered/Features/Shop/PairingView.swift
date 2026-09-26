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
                    .headline(29)
            }

            Text("Searches run in your Brave on the laptop.")
                .font(.system(size: 14.5))
                .foregroundStyle(Color.secondary)

            codeField

            Button {
                Task { await claim() }
            } label: {
                Text(status == .claiming ? "Claiming…" : "Claim")
                    .font(.system(size: 18.5, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: Theme.approveHeight)
                    .foregroundStyle(Color.white)
                    .background(Color.ink, in: Capsule())
            }
            .buttonStyle(PressScaleStyle(scale: 0.965))
            .disabled(!canClaim)
            .opacity(canClaim ? 1 : 0.45)
            .animation(Motion.ui, value: canClaim)
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
                Color.screen.ignoresSafeArea()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { focused = true }
    }

    private var canClaim: Bool {
        PairingCode.normalize(code).count == 6 && status != .claiming
    }

    private var codeField: some View {
        TextField("ABC234", text: $code)
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
            .keyboardType(.asciiCapable)
            .textContentType(.oneTimeCode)
            .font(.system(size: 28, weight: .semibold, design: .monospaced))
            .monospacedDigit()
            .multilineTextAlignment(.center)
            .focused($focused)
            .padding(.vertical, 16)
            .foregroundStyle(Color.inkSoft)
            .background(Color.composer, in: Capsule())
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
                .font(.system(size: 14.5))
                .foregroundStyle(Color.inkSoft)
                .coveredSwap()
        case .failure(let message):
            Text(message)
                .font(.system(size: 14.5))
                .foregroundStyle(Color.secondary)
                .coveredSwap()
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
            withAnimation(Motion.soft) {
                status = .success(userId: claimed.userId)
            }
            await AppState.shared.refresh()
        } catch let error as APIError {
            Haptics.light()
            withAnimation(Motion.soft) {
                status = .failure(PairingCode.plainError(error))
            }
        } catch {
            Haptics.light()
            withAnimation(Motion.soft) {
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
    /// A–Z and 2–9, excluding 0 / O / 1 / I.
    private static let alphabet = Set("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")

    static func normalize(_ raw: String) -> String {
        raw.uppercased()
            .replacingOccurrences(of: " ", with: "")
            .filter { alphabet.contains($0) }
    }

    static func plainError(_ error: APIError) -> String {
        switch error {
        case .http(let status, let message):
            if status == 404 {
                if message == "route_missing" {
                    return "Pairing isn't live on the server yet"
                }
                return "That code isn't valid — get a fresh one from the Covered icon in Brave"
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
