import SwiftUI

struct ListingCard: View {
    let item: ShortlistItem
    let decision: Decision?
    let chosen: Bool
    var twoUp = false
    let namespace: Namespace.ID
    let onLimit: () -> Void
    @State private var showLightbox = false

    private var rejected: Bool {
        guard let decision else { return false }
        return decision.mislisting || !decision.sameItem
    }

    private var rejectChip: String? {
        guard let decision, rejected else { return nil }
        if decision.mislisting, let photo = decision.photoReason, !photo.isEmpty {
            return photo
        }
        if decision.mislisting { return "not the item" }
        if !decision.sameItem { return "not the item" }
        return nil
    }

    var body: some View {
        Group {
            if twoUp {
                twoUpBody
            } else {
                listBody
            }
        }
        .matchedGeometryEffect(id: item.id, in: namespace)
        .fullScreenCover(isPresented: $showLightbox) {
            MislistingLightbox(
                item: item,
                reason: decision?.photoReason ?? decision?.reason ?? "not the item"
            )
        }
    }

    private var listBody: some View {
        HStack(alignment: .top, spacing: 14) {
            OfferPhoto(item: item, rejected: rejected)
                .onTapGesture {
                    if rejected { showLightbox = true }
                }
                .accessibilityIdentifier(rejected ? "shop.mislisting" : "")
                .accessibilityAddTraits(.isButton)
            VStack(alignment: .leading, spacing: 4) {
                if chosen {
                    CoveredPickLabel()
                        .padding(.bottom, 2)
                }
                priceRow
                title
                Text(item.merchant)
                    .font(.system(size: 13))
                    .foregroundStyle(rejected ? Color.mutedLine : Color.secondary)
                    .lineLimit(1)
                if item.section == .sponsored {
                    NeutralChip(text: "Ad")
                }
                if let rejectChip {
                    NeutralChip(text: rejectChip)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            cardMenu
        }
        .padding(13)
        .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                .strokeBorder(chosen ? Color.ink : Color.hairline, lineWidth: chosen ? 2.5 : 1)
        )
    }

    private var twoUpBody: some View {
        VStack(alignment: .leading, spacing: 0) {
            OfferPhoto(item: item, rejected: rejected, banner: true, bannerWidth: 154)
                .onTapGesture {
                    if rejected { showLightbox = true }
                }
                .padding(7.5)
            VStack(alignment: .leading, spacing: 4) {
                if chosen { CoveredPickLabel() }
                priceRow
                title
                Text(item.merchant)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.secondary)
                    .lineLimit(2)
            }
            .padding(.horizontal, 11)
            Spacer(minLength: 8)
            chip
                .padding(11)
        }
        .frame(width: 169, height: 347, alignment: .topLeading)
        .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                .strokeBorder(chosen ? Color.ink : Color.hairline, lineWidth: chosen ? 2.5 : 1)
        )
    }

    @ViewBuilder
    private var chip: some View {
        if rejected, let rejectChip {
            NeutralChip(text: rejectChip)
        } else if let decision, isProtected(decision) {
            RightsChip(text: rightsLine(decision), compact: true)
        } else if let decision, decision.sellerType == .privateSeller {
            NeutralChip(text: "private sale · as described only")
        } else if let decision, decision.sellerType == .overseasBusiness {
            NeutralChip(text: "ships from overseas")
        }
    }

    private var priceRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: 7) {
            Text(item.priceLabel)
                .filmMoney(29, weight: .bold, tracking: -0.9)
                .foregroundStyle(rejected ? Color.mutedLine : Color.inkSoft)
                .overlay(alignment: .center) {
                    if rejected {
                        Rectangle()
                            .fill(Color.mutedLine)
                            .frame(height: 2.5)
                    }
                }
            if let compare = itemCompare {
                Text("was \(compare)")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.tertiary)
                    .strikethrough(true, color: Color.tertiary)
            }
        }
    }

    @ViewBuilder
    private var title: some View {
        let text = Text(item.title)
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(rejected ? Color.mutedLine : Color.inkSoft)
            .lineLimit(2)
            .multilineTextAlignment(.leading)
        if let raw = item.productUrl, let url = URL(string: raw) {
            Link(destination: url) { text }
        } else {
            text
        }
    }

    private var cardMenu: some View {
        Menu {
            Button("Set a limit…", action: onLimit)
        } label: {
            Text("···")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.secondary)
                .frame(width: 22, height: 22)
        }
    }

    private var itemCompare: String? {
        if case .offer(let offer) = item.raw, let compare = offer.compareAt, !compare.isEmpty {
            return compare.hasPrefix("£") ? compare : "£\(compare)"
        }
        return nil
    }

    private func rightsLine(_ decision: Decision) -> String {
        if decision.rights.isEmpty {
            return "14-day cancellation · 30-day fault refund"
        }
        return decision.rights.prefix(2).joined(separator: " · ")
    }
}

struct MislistingLightbox: View {
    let item: ShortlistItem
    let reason: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color.black.opacity(0.92).ignoresSafeArea()
            VStack(spacing: 18) {
                OfferPhoto(item: item, size: 280, corner: 20, rejected: true)
                Text(reason)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Color.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)
                    .accessibilityIdentifier("shop.mislistingReason")
                Button("Close") { dismiss() }
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 22)
                    .frame(height: 40)
                    .overlay(Capsule().strokeBorder(Color.white.opacity(0.4), lineWidth: 1))
                    .accessibilityIdentifier("shop.mislistingClose")
            }
        }
        .accessibilityIdentifier("shop.mislistingLightbox")
    }
}
