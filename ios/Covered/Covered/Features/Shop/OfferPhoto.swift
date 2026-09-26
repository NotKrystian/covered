import SwiftUI
import UIKit

struct OfferPhoto: View {
    let item: ShortlistItem
    var size: CGFloat = Theme.listPhoto
    var corner: CGFloat = Theme.radiusPhoto
    var rejected = false
    var banner = false
    var bannerWidth: CGFloat = 154

    var body: some View {
        Group {
            if let data = DataURLImage.decode(item.imageDataUrl), let image = UIImage(data: data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else if let url = remoteURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .empty:
                        Color.photoHole
                    case .failure:
                        Color.photoHole
                    @unknown default:
                        Color.photoHole
                    }
                }
            } else {
                Color.photoHole
            }
        }
        .frame(width: banner ? bannerWidth : size, height: banner ? 150 : size)
        .saturation(rejected ? 0 : 1)
        .opacity(rejected ? 0.55 : 1)
        .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
        .background(
            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .fill(Color.photoHole)
        )
    }

    private var remoteURL: URL? {
        if let imageUrl = item.imageUrl, let url = URL(string: imageUrl) { return url }
        if let first = item.imageUrls.first, let url = URL(string: first) { return url }
        return nil
    }
}
