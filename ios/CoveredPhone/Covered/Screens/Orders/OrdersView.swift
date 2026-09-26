// Approved receipts for this covered_uid, and the returns-and-repairs chat per order.
import SwiftUI

@MainActor
@Observable
final class OrdersStore {
    var orders: [OrderRecord] = []
    var totalPence = 0
    var count = 0
    var loading = true
    var error: String?

    let api = CoveredAPI.shared

    func refresh() async {
        defer { loading = false }
        do {
            let response = try await api.orders()
            orders = response.orders
            totalPence = response.totalPence
            count = response.count
            error = nil
        } catch {
            self.error = (error as? APIError)?.message ?? error.localizedDescription
        }
    }
}

struct OrdersView: View {
    @Environment(AppModel.self) private var app
    @State private var store = OrdersStore()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    BrandMark().padding(.top, 12)
                    HStack(alignment: .firstTextBaseline) {
                        Text("Orders").headline(30)
                        Spacer()
                        Text("\(store.count) order\(store.count == 1 ? "" : "s") · \(Money.format(store.totalPence)) spent")
                            .font(.system(size: 13))
                            .tabular()
                            .foregroundStyle(Theme.muted)
                    }
                    Text("Receipts this phone has approved. Approve spends the bot wallet, nothing else.")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.muted)

                    if store.loading {
                        ProgressView().tint(Theme.accent).frame(maxWidth: .infinity).padding(.vertical, 30)
                    } else if let error = store.error {
                        Text(error).font(.system(size: 13)).foregroundStyle(Theme.danger)
                    } else if store.orders.isEmpty {
                        Text("No approved orders yet.")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 40)
                            .background(
                                RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous)
                                    .strokeBorder(Theme.line, style: StrokeStyle(lineWidth: 1, dash: [5, 5]))
                            )
                    } else {
                        VStack(spacing: 10) {
                            ForEach(store.orders) { order in
                                NavigationLink(value: order) {
                                    OrderRow(order: order)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
            .background(Theme.background)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await store.refresh() }
            .task { await store.refresh() }
            .navigationDestination(for: OrderRecord.self) { order in
                OrderDetailView(order: order)
            }
        }
    }
}

private struct OrderRow: View {
    let order: OrderRecord

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(order.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text("\(order.merchant) · \(Dates.short(order.t))")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
                HStack(spacing: 8) {
                    Text(order.id.prefix(8) + "…")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Theme.muted)
                    Chip(text: order.section.rawValue)
                    if let last = order.aftercare.last {
                        Chip(text: last.refused ? "refused" : last.remedy.rawValue)
                    }
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                Text(Money.format(order.pricePence))
                    .font(.system(size: 17, weight: .semibold))
                    .tabular()
                    .foregroundStyle(Theme.foreground)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.muted)
            }
        }
        .padding(14)
        .panelCard()
    }
}

struct OrderDetailView: View {
    @Environment(\.dismiss) private var dismiss
    let order: OrderRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Button { dismiss() } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.foreground)
                        .frame(width: 32, height: 32)
                        .background(Circle().fill(Theme.panelRaised))
                }
                .buttonStyle(.plain)
                VStack(alignment: .leading, spacing: 2) {
                    Text(order.title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(1)
                    Text("\(order.merchant) · \(Money.format(order.pricePence)) · \(Dates.day(order.t))")
                        .font(.system(size: 12))
                        .tabular()
                        .foregroundStyle(Theme.muted)
                }
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(Theme.panel)
            .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }

            AftercareChatView(order: order)
        }
        .background(Theme.background)
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
    }
}
