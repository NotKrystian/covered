import SwiftUI

/// One judged listing. Chosen row glows with the accent; rejected rows are grey
/// and struck through with the photo or identity reason. One accent only.
struct ListingRow: View {
    let item: ShortlistItem
    let decision: Decision?
    let chosen: Bool
    let onApprove: () -> Void
    let onLimit: () -> Void
    let onOpen: (URL) -> Void

    private var rejected: Bool { decision?.rejected ?? false }

    private var reason: String? {
        guard let decision else { return nil }
        if decision.mislisting, let photo = decision.photoReason { return photo }
        return decision.reason
    }

    private var metaLine: String {
        var parts = [item.merchant]
        if let delivery = item.delivery, !delivery.isEmpty { parts.append(delivery) }
        if let returns = item.returns, !returns.isEmpty { parts.append(returns) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 14) {
                photo
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        title
                        Spacer(minLength: 8)
                        Text(item.priceLabel)
                            .font(.system(size: 18, weight: .semibold))
                            .tabular()
                            .foregroundStyle(rejected ? Theme.muted : Theme.foreground)
                    }
                    HStack(spacing: 6) {
                        if chosen { Chip(text: "Recommended", accent: true) }
                        if item.section == .sponsored { Chip(text: "Ad") }
                        if let badge = item.badge, !badge.isEmpty { Chip(text: badge) }
                    }
                    .padding(.top, chosen || item.section == .sponsored || item.badge != nil ? 2 : 0)
                    Text(metaLine)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(2)
                    if let decision {
                        Text(decision.sellerLine)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.muted)
                    }
                }
            }

            if let reason {
                Text((rejected && decision?.mislisting == true ? "Mislisting: " : "") + reason)
                    .font(.system(size: 14))
                    .lineSpacing(2)
                    .foregroundStyle(chosen ? Theme.accent : Theme.muted)
                    .strikethrough(rejected, color: Theme.muted)
            }

            HStack(spacing: 10) {
                if chosen {
                    Button("Approve", action: onApprove)
                        .buttonStyle(PrimaryButtonStyle())
                }
                Button("Limit", action: onLimit)
                    .buttonStyle(QuietButtonStyle())
                Spacer()
            }
        }
        .padding(16)
        .panelCard(border: chosen ? Theme.accent : Theme.line)
        .background(
            RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous)
                .fill(chosen ? Theme.accentSoft : Color.clear)
        )
        .opacity(rejected ? 0.7 : 1)
    }

    @ViewBuilder
    private var photo: some View {
        if let link = item.productLink {
            Button { onOpen(link) } label: { ListingPhoto(item: item, size: 88, dim: rejected) }
                .buttonStyle(.plain)
        } else {
            ListingPhoto(item: item, size: 88, dim: rejected)
        }
    }

    @ViewBuilder
    private var title: some View {
        let text = Text(item.title)
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(rejected ? Theme.muted : Theme.foreground)
            .strikethrough(rejected, color: Theme.muted)
            .lineLimit(3)
            .multilineTextAlignment(.leading)
        if let link = item.productLink {
            Button { onOpen(link) } label: {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    text
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                }
            }
            .buttonStyle(.plain)
        } else {
            text
        }
    }
}
