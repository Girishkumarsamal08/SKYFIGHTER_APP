package main

import (
	"embed"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

//go:embed web/*
var embeddedWebFS embed.FS

func findBrowser() (string, []string) {
	// Standard Edge and Chrome paths on Windows
	paths := []string{
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Google", "Chrome", "Application", "chrome.exe"),
	}

	for _, p := range paths {
		if p != "" {
			if _, err := os.Stat(p); err == nil {
				return p, []string{"--app=%s", "--window-size=1280,820", "--disable-features=TranslateUI"}
			}
		}
	}

	// Fallback to default browser
	return "rundll32.exe", []string{"url.dll,FileProtocolHandler", "%s"}
}

func main() {
	// 1. Create sub-filesystem for web files
	subFS, err := fs.Sub(embeddedWebFS, "web")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load embedded web files: %v\n", err)
		os.Exit(1)
	}

	// 2. Find a free port
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		// Fallback to standard 8088
		listener, err = net.Listen("tcp", "127.0.0.1:8088")
		if err != nil {
			fmt.Fprintf(os.Stderr, "Failed to bind local listener: %v\n", err)
			os.Exit(1)
		}
	}
	defer listener.Close()

	port := listener.Addr().(*net.TCPAddr).Port
	targetURL := fmt.Sprintf("http://127.0.0.1:%d/index.html", port)

	// 3. Start local HTTP server
	fileServer := http.FileServer(http.FS(subFS))
	http.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Allow CORS for local websocket bridging
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		fileServer.ServeHTTP(w, r)
	}))

	go func() {
		if err := http.Serve(listener, nil); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "HTTP server error: %v\n", err)
		}
	}()

	// 4. Wait a brief moment for server to warm up
	time.Sleep(100 * time.Millisecond)

	// 5. Launch dedicated browser app window
	browserPath, argTemplates := findBrowser()
	var args []string
	for _, tmpl := range argTemplates {
		if tmpl == "%s" {
			args = append(args, targetURL)
		} else if tmpl == "--app=%s" {
			args = append(args, fmt.Sprintf("--app=%s", targetURL))
		} else {
			args = append(args, tmpl)
		}
	}

	cmd := exec.Command(browserPath, args...)
	if err := cmd.Run(); err != nil {
		// If app mode fails, try launching default browser
		_ = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", targetURL).Start()
		// Keep server alive
		select {}
	}
}
