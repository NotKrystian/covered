import SwiftUI

struct ListingCard: View {
    let item: ShortlistItem
    let decision: Decision?
    let chosen: Bool
    let namespace: Namespace.ID
    let onApprove: () -> Void
    let onLimit: () -> Void

    private var rejected: Bool {
        guard let decision else { return false }
        return decision.mislisting || !decision.sameItem
    }

    private var reason: String? {
        guard let decision else { return nil }
        if decision.mislisting, let photo = decision.photoReason, !photo.isEmpty {
            return photo
        }
        return decision.reason.isEmpty ? nil : decision.reason
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                OfferPhoto(item: item)
                    .opacity(rejected ? 0.45 : 1)

                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        title
                        Spacer(minLength: 8)
                        Text(item.priceLabel)
                            .font(.money(18))
                            .foregroundStyle(rejected ? Color.dangerGrey : Color.canvas)
                    }
                    HStack(spacing: 6) {
                        if chosen {
                            chip("Chosen", accent: true)
                        }
                        if item.section == .sponsored {
                            chip("Ad", accent: false)
                        }
                    }
                    Text(metaLine)
                        .font(.ui(13))
                        .foregroundStyle(Color.muted)
                        .lineLimit(2)
                }
            }

            if let reason {
                Text(reason)
                    .font(.ui(14))
                    .foregroundStyle(chosen ? Color.accent : Color.muted)
                    .strikethrough(rejected, color: Color.dangerGrey)
            }

            HStack(spacing: 10) {
                if chosen {
                    Button("Approve", action: onApprove)
                        .buttonStyle(CoveredPrimaryButtonStyle())
                        .accessibilityIdentifier("shop.approve")
                        .accessibilityAddTraits(.isButton)
                }
                Menu {
                    Button("Set a limit…", action: onLimit)
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.ui(15, weight: .semibold))
                        .foregroundStyle(Color.muted)
                        .frame(width: 36, height: 36)
                }
                Spacer()
            }
        }
        .padding(16)
        .foregroundStyle(Color.canvas)
        .background(
            RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                .fill(Color.ink)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                .strokeBorder(chosen ? Color.accent : Color.clear, lineWidth: 1.5)
        )
        .matchedGeometryEffect(id: chosen ? "chosen-card" : item.id, in: namespace)
    }

    @ViewBuilder
    private var title: some View {
        let text = Text(item.title)
            .font(.ui(16, weight: .medium))
            .foregroundStyle(rejected ? Color.dangerGrey : Color.canvas)
            .strikethrough(rejected, color: Color.dangerGrey)
            .lineLimit(3)
            .multilineTextAlignment(.leading)
        if let raw = item.productUrl, let url = URL(string: raw) {
            Link(destination: url) { text }
        } else {
            text
        }
    }

    private var metaLine: String {
        [item.merchant, item.delivery, item.returns]
            .compactMap { value in
                guard let value, !value.isEmpty else { return nil }
                return value
            }
            .joined(separator: " · ")
    }

    private func chip(_ text: String, accent: Bool) -> some View {
        Text(text)
            .font(.ui(11, weight: .semibold))
            .foregroundStyle(accent ? Color.ink : Color.canvas)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(
                Capsule().fill(accent ? Color.accent : Color.muted.opacity(0.35))
            )
    }
}
