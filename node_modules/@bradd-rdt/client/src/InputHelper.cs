using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace InputHelper {
    class Program {
        [DllImport("user32.dll")]
        static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);

        private const int MOUSEEVENTF_LEFTDOWN = 0x02;
        private const int MOUSEEVENTF_LEFTUP = 0x04;
        private const int MOUSEEVENTF_RIGHTDOWN = 0x08;
        private const int MOUSEEVENTF_RIGHTUP = 0x10;
        private const int MOUSEEVENTF_WHEEL = 0x0800;

        static void Main(string[] args) {
            // Check if arguments are passed directly (legacy/one-off mode)
            if (args.Length > 0) {
                ProcessCommand(args);
                return;
            }

            // Interactive mode (Persistent process)
            string line;
            while ((line = Console.ReadLine()) != null) {
                if (string.IsNullOrWhiteSpace(line)) continue;
                // Split by space but respect quotes if needed (simple split for now)
                string[] cmdArgs = line.Split(' ');
                ProcessCommand(cmdArgs);
            }
        }

        static void ProcessCommand(string[] args) {
            try {
                string command = args[0];

                if (command == "move" && args.Length >= 3) {
                    int x = int.Parse(args[1]);
                    int y = int.Parse(args[2]);
                    SetCursorPos(x, y);
                    // Console.WriteLine($"Moved to {x},{y}");
                }
                else if (command == "mousedown" && args.Length >= 2) {
                    string btn = args[1];
                    if (btn == "left") {
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                    } else if (btn == "right") {
                        mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
                    }
                    Console.WriteLine("MouseDown " + btn);
                }
                else if (command == "mouseup" && args.Length >= 2) {
                    string btn = args[1];
                    if (btn == "left") {
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    } else if (btn == "right") {
                        mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
                    }
                    Console.WriteLine("MouseUp " + btn);
                }
                else if (command == "click" && args.Length >= 2) {
                    string btn = args[1];
                    if (btn == "left") {
                        mouse_event(MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    } else if (btn == "right") {
                        mouse_event(MOUSEEVENTF_RIGHTDOWN | MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
                    }
                }
                else if (command == "click_at" && args.Length >= 4) {
                    int x = int.Parse(args[1]);
                    int y = int.Parse(args[2]);
                    string btn = args[3];
                    SetCursorPos(x, y);
                    // Small delay might be needed? Usually not for simple click
                    if (btn == "left") {
                        mouse_event(MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    } else if (btn == "right") {
                        mouse_event(MOUSEEVENTF_RIGHTDOWN | MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
                    }
                }
                else if (command == "scroll" && args.Length >= 2) {
                    int amount = int.Parse(args[1]);
                    // amount is usually +/- 120 per notch.
                    mouse_event(MOUSEEVENTF_WHEEL, 0, 0, amount, 0);
                }
                else if (command == "type" && args.Length >= 2) {
                    // Reconstruct text if it was split by spaces (simple approach)
                    string text = args[1]; 
                    if (args.Length > 2) {
                         for (int i = 2; i < args.Length; i++) text += " " + args[i];
                    }
                    // Use Send instead of SendWait to prevent blocking if target app is busy
                    SendKeys.Send(text);
                }
                else if (command == "ping") {
                    Console.WriteLine("pong");
                }
            } catch (Exception e) {
                Console.WriteLine("Error: " + e.Message);
            }
        }
    }
}