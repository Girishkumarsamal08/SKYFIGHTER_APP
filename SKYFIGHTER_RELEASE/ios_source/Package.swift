// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SkyfighterApp",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "SkyfighterApp",
            targets: ["SkyfighterApp"]
        ),
    ],
    dependencies: [],
    targets: [
        .target(
            name: "SkyfighterApp",
            dependencies: [],
            path: "Sources/SkyfighterApp"
        ),
        .testTarget(
            name: "SkyfighterAppTests",
            dependencies: ["SkyfighterApp"],
            path: "Tests/SkyfighterAppTests"
        ),
    ]
)
