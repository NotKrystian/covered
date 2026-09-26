import SwiftUI

struct OrdersView: View {
    @State private var store = OrdersStore()
    @State private var shownTotal: Double = 0
    @Bindable private var tabs = CoveredTabs.shared
    private let state = AppState.shared

    var body: some View {
        NavigationStack {
            ZStack {
                Color.screen.ignoresSafeArea()
                VStack(spacing: 0) {
                    FilmHeader(
                        showWallet: true,
                        balancePence: AppState.shared.wallet?.balancePence ?? 0
                    )
                    content
                        .coveredSwap()
                }
            }
            .navigationBarHidden(true)
            .refreshable { await store.refresh() }
            .navigationDestination(for: Order.self) { order in
                OrderDetailView(order: order, store: store)
            }
            .task { await store.refresh() }
            .onChange(of: tabs.selection) { _, next in
                if next == .orders {
                    Task { await store.refresh() }
                }
            }
            .onChange(of: state.orders) { _, next in
                if !next.isEmpty {
                    store.orders = next
                    store.count = next.count
                    store.totalPence = next.reduce(0) { $0 + $1.pricePence }
                }
            }
            .onChange(of: store.totalPence) { _, next in
                withAnimation(Motion.money) { shownTotal = Double(next) }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if store.isLoading && store.orders.isEmpty && store.errorMessage == nil {
            ProgressView()
                .tint(Color.ink)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let message = store.errorMessage, store.orders.isEmpty {
            errorState(message)
        } else if store.orders.isEmpty {
            emptyState
        } else {
            orderList
        }
    }

    private var emptyState: some View {
        Text("No approved orders yet. Approve spends your wallet, then your orders appear here.")
            .font(.system(size: 14.5))
            .foregroundStyle(Color.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.horizontal, Theme.inset)
            .padding(.top, 16)
    }

    private func errorState(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(message)
                .font(.system(size: 14.5))
                .foregroundStyle(Color.inkSoft)
            QuietTextButton(title: "Try again") {
                Task { await store.refresh() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, Theme.inset)
        .padding(.top, 16)
    }

    private var orderList: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                ForEach(store.orders) { order in
                    NavigationLink(value: order) {
                        OrderRow(order: order, watch: store.watch(for: order))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("orders.row")
                }
            }
            .padding(.horizontal, Theme.inset)
            .padding(.top, 8)
            .padding(.bottom, 20)
        }
    }
}

struct OrderRow: View {
    let order: Order
    var watch: SwitchWatch?
    var compact = false

    private var window: ReturnWindow { order.returnWindow(watch: watch) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                orderThumb
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(order.shortId) · \(formatGBP(order.pricePence))")
                        .font(.system(size: 18.5, weight: .semibold))
                        .tracking(-0.4)
                        .foregroundStyle(Color.inkSoft)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Text(metaLine)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.secondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 4)
                if compact || watch != nil {
                    ReturnWindowRing(window: window, compact: true)
                }
            }
            if !compact, order.cancelledAt == nil, watch?.blocked == nil {
                RightsChip(text: order.rightsChipText, compact: true)
            }
        }
        .padding(14.5)
        .background(
            (compact ? Color.panel : Color.white),
            in: RoundedRectangle(cornerRadius: compact ? 22 : Theme.radius, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: compact ? 22 : Theme.radius, style: .continuous)
                .strokeBorder(Color.hairline, lineWidth: compact ? 0 : 1)
        )
    }

    private var metaLine: String {
        if order.cancelledAt != nil {
            return order.rightsChipText
        }
        if window.isOpen {
            return "Paid · \(order.merchant)"
        }
        return "Paid · \(order.merchant)"
    }

    private var orderThumb: some View {
        RoundedRectangle(cornerRadius: Theme.radiusPhotoCompact, style: .continuous)
            .fill(Color.photoHole)
            .frame(width: compact ? 62 : 66.5, height: compact ? 62 : 66.5)
            .overlay {
                if case .offer(let offer) = order.switchCheck?.offer?.chosen {
                    OfferPhoto(
                        item: offerToItem(offer, index: 0),
                        size: compact ? 62 : 66.5,
                        corner: Theme.radiusPhotoCompact
                    )
                }
            }
    }
}

struct CountingMoney: View, Animatable {
    var pence: Double

    var animatableData: Double {
        get { pence }
        set { pence = newValue }
    }

    var body: some View {
        Text(formatGBP(Int(pence.rounded())))
            .filmMoney(58.5, weight: .bold, tracking: -2.3)
            .foregroundStyle(Color.inkSoft)
    }
}

struct ReturnWindowRing: View {
    let window: ReturnWindow
    var compact = false

    var body: some View {
        let radius: CGFloat = compact ? 20 : 58.5
        let stroke: CGFloat = compact ? 4.5 : 11
        ZStack {
            Circle()
                .stroke(Color.dividerStrong, lineWidth: stroke)
            Circle()
                .trim(from: 0, to: window.progress)
                .stroke(
                    Color.ink,
                    style: StrokeStyle(lineWidth: stroke, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            if !compact {
                VStack(spacing: 2) {
                    Text(window.daysLabel)
                        .filmMoney(42, weight: .bold, tracking: -1.2)
                        .foregroundStyle(Color.inkSoft)
                    Text("days left")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.secondary)
                }
            }
        }
        .frame(width: radius * 2, height: radius * 2)
        .accessibilityLabel(window.headline)
        .animation(Motion.ring, value: window.progress)
    }
}
