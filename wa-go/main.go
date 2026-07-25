// WhatsApp reader con whatsmeow (motor robusto, el mismo que usa Beeper/Matrix). Reemplaza a Baileys.
// Escribe a data/messages.jsonl en el mismo formato. Sesión en auth/wa-<cuenta>.db. Corre desde la raíz del proyecto.
// Uso: wa-go/wa <cuenta>   (wa1, wa2, wa3)
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/skip2/go-qrcode"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

var account = "wa1"
var client *whatsmeow.Client

var phones = map[string]string{"wa1": os.Getenv("WA1_PHONE")} // el número propio sale del entorno, no hardcodeado

func writeJSONL(rec map[string]interface{}) {
	f, err := os.OpenFile("data/messages.jsonl", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	b, _ := json.Marshal(rec)
	f.Write(append(b, '\n'))
}

func handler(rawEvt interface{}) {
	switch evt := rawEvt.(type) {
	case *events.Message:
		info := evt.Info
		if info.Chat.String() == "status@broadcast" {
			return
		}
		m := evt.Message
		text := m.GetConversation()
		if text == "" {
			text = m.GetExtendedTextMessage().GetText()
		}
		if text == "" {
			switch {
			case m.GetImageMessage() != nil:
				text = "[imagen]"
			case m.GetVideoMessage() != nil:
				text = "[video]"
			case m.GetAudioMessage() != nil:
				text = "[audio]"
			case m.GetStickerMessage() != nil:
				text = "[sticker]"
			case m.GetDocumentMessage() != nil:
				text = "[documento]"
			case m.GetLocationMessage() != nil:
				text = "[ubicación]"
			case m.GetContactMessage() != nil:
				text = "[contacto]"
			default:
				text = "[otro]"
			}
		}
		dir := "in"
		name := info.PushName
		if info.IsFromMe {
			dir = "out"
			name = os.Getenv("OWNER_NAME")
			if name == "" {
				name = "Me"
			}
		}
		rec := map[string]interface{}{
			"channel": "whatsapp", "account": account, "id": info.ID,
			"jid": info.Chat.String(), "name": name, "text": text,
			"ts": info.Timestamp.UnixMilli(), "dir": dir,
		}
		if info.IsGroup {
			if gi, err := client.GetGroupInfo(context.Background(), info.Chat); err == nil {
				rec["group"] = gi.Name
			}
		}
		writeJSONL(rec)
		icon := "💬"
		if dir == "out" {
			icon = "➡️"
		}
		fmt.Printf("%s [%s] %s: %s\n", icon, account, name, text)
	case *events.Connected:
		os.WriteFile("/tmp/wa_ok_"+account, []byte(fmt.Sprint(time.Now().Unix())), 0644)
		os.Remove("/tmp/wa_code_" + account)
		fmt.Printf("✅ [%s] CONECTADO\n", account)
	case *events.LoggedOut:
		fmt.Printf("[%s] logged out\n", account)
		os.Remove("/tmp/wa_ok_" + account)
	}
}

func main() {
	if len(os.Args) > 1 {
		account = os.Args[1]
	}
	ctx := context.Background()
	dbLog := waLog.Stdout("DB", "ERROR", true)
	container, err := sqlstore.New(ctx, "sqlite3", "file:auth/wa-"+account+".db?_foreign_keys=on", dbLog)
	if err != nil {
		panic(err)
	}
	deviceStore, err := container.GetFirstDevice(ctx)
	if err != nil {
		panic(err)
	}
	client = whatsmeow.NewClient(deviceStore, waLog.Stdout("Client", "ERROR", true))
	client.AddEventHandler(handler)

	if client.Store.ID == nil {
		qrChan, _ := client.GetQRChannel(ctx)
		if err = client.Connect(); err != nil {
			panic(err)
		}
		if phone := phones[account]; phone != "" {
			go func() {
				time.Sleep(4 * time.Second)
				code, err := client.PairPhone(ctx, phone, true, whatsmeow.PairClientChrome, "Chrome (macOS)")
				if err == nil {
					os.WriteFile("/tmp/wa_code_"+account, []byte(code), 0644)
					fmt.Printf("🔑 [%s] CÓDIGO: %s\n", account, code)
				} else {
					fmt.Println("pair err:", err)
				}
			}()
		}
		for evt := range qrChan {
			if evt.Event == "code" {
				qrcode.WriteFile(evt.Code, qrcode.Medium, 400, "/tmp/wa_qr_"+account+".png")
				fmt.Printf("📱 [%s] QR actualizado\n", account)
			} else {
				fmt.Printf("[%s] login: %s\n", account, evt.Event)
			}
		}
	} else {
		if err = client.Connect(); err != nil {
			panic(err)
		}
		fmt.Printf("[%s] reconectando sesión...\n", account)
	}

	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	<-c
	client.Disconnect()
}
