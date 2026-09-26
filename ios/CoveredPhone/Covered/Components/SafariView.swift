import SafariServices
import SwiftUI

/// In-app browser for a listing's `product_url`.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let config = SFSafariViewController.Configuration()
        config.entersReaderIfAvailable = false
        let controller = SFSafariViewController(url: url, configuration: config)
        controller.preferredBarTintColor = UIColor(Theme.panel)
        controller.preferredControlTintColor = UIColor(Theme.accent)
        return controller
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

/// Lets a `URL` drive `.sheet(item:)`.
struct WebLink: Identifiable, Hashable {
    let url: URL
    var id: String { url.absoluteString }
}
