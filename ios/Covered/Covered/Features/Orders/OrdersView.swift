import SwiftUI

struct OrdersView: View {
    @State private var store = OrdersStore()
    @State private var shownCount: Double = 0
    @State private var shownTotal: Double = 0

    var body: some View {
        NavigationStack {
            ZStack {
                Color.canvas.ignoresSafeArea()
                content
                    .ordersSwap()
            }
            .navigationTitle("Orders")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(Color.canvas, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.light, for: .navigationBar)
            .refreshable { await store.refresh() }
            .navigationDestination(for: Order.self) { order in
                OrderDetailView(order: order, store: store)
            }
            .task { await store.refresh() }
            .onChange(of: store.totalPence) { _, next in
                withAnimation(Motion.spring) { shownTotal = Double(next) }
            }
            .onChange(of: store.count) { _, next in
                withAnimation(Motion.spring) { shownCount = Double(next) }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if store.isLoading && store.orders.isEmpty && store.errorMessage == nil {
            ProgressView()
                .tint(Color.accent)
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
        VStack(alignment: .leading, spacing: Theme.pad) {
            Text("No approved orders yet. Approve spends your wallet, then your orders appear here.")
                .font(.ui(16))
                .foregroundStyle(Color.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(Theme.padLarge)
    }

    private func errorState(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.pad) {
            Text(message)
                .font(.ui(15))
                .foregroundStyle(Color.ink)
            Button("Try again") {
                Task { await store.refresh() }
            }
            .font(.ui(15, weight: .semibold))
            .foregroundStyle(Color.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(Theme.padLarge)
    }

    private var orderList: some View {
        List {
            header
                .listRowInsets(EdgeInsets(top: Theme.pad, leading: Theme.pad, bottom: Theme.padSmall, trailing: Theme.pad))
                .listRowBackground(Color.canvas)
                .listRowSeparator(.hidden)

            ForEach(store.orders) { order in
                NavigationLink(value: order) {
                    OrderRow(order: order)
                }
                .listRowInsets(EdgeInsets(top: 6, leading: Theme.pad, bottom: 6, trailing: Theme.pad))
                .listRowBackground(Color.canvas)
                .listRowSeparator(.hidden)
                .accessibilityIdentifier("orders.row")
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color.canvas)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(countLabel)
                .font(.ui(15, weight: .medium))
                .foregroundStyle(Color.muted)
            CountingMoney(pence: shownTotal)
                .accessibilityLabel("\(formatGBP(store.totalPence)) spent")
        }
        .onAppear {
            withAnimation(Motion.spring) {
                shownCount = Double(store.count)
                shownTotal = Double(store.totalPence)
            }
        }
    }

    private var countLabel: String {
        let n = Int(shownCount.rounded())
        return n == 1 ? "1 order" : "\(n) orders"
    }
}

private struct OrderRow: View {
    let order: Order

    private var window: ReturnWindow { order.returnWindow() }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(order.title)
                    .font(.ui(16, weight: .semibold))
                    .foregroundStyle(Color.canvas)
                    .lineLimit(2)
                Spacer(minLength: 8)
                Text(formatGBP(order.pricePence))
                    .font(.money(16))
                    .foregroundStyle(Color.accent)
            }
            HStack {
                Text(order.merchant)
                    .font(.ui(13))
                    .foregroundStyle(Color.canvas.opacity(0.72))
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(OrderDate.listLabel(order.t))
                    .font(.ui(12))
                    .foregroundStyle(Color.canvas.opacity(0.55))
                    .monospacedDigit()
            }
            HStack(alignment: .center, spacing: 10) {
                ReturnWindowRing(window: window)
                VStack(alignment: .leading, spacing: 2) {
                    Text(window.headline)
                        .font(.ui(13, weight: .medium))
                        .foregroundStyle(Color.canvas)
                    Text(window.footnote)
                        .font(.ui(11))
                        .foregroundStyle(Color.canvas.opacity(0.5))
                }
            }
        }
        .padding(Theme.pad)
        .background(
            RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                .fill(Color.black)
        )
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
            .font(.money(28, weight: .semibold))
            .foregroundStyle(Color.ink)
    }
}

struct ReturnWindowRing: View {
    let window: ReturnWindow

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.canvas.opacity(0.16), lineWidth: 3)
            Circle()
                .trim(from: 0, to: window.progress)
                .stroke(
                    window.isOpen ? Color.accent : Color.dangerGrey,
                    style: StrokeStyle(lineWidth: 3, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
        }
        .frame(width: 28, height: 28)
        .accessibilityLabel(window.headline)
        .animation(Motion.spring, value: window.progress)
    }
}
