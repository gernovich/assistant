/**
 * WindowTransport — единый контракт моста сообщений между приложением и диалогом.
 *
 * Цель: UI и логика не знают "как именно" доставляются сообщения (IPC/Channel/WebSocket и т.д.).
 * Реализация скрыта внутри конкретного транспорта; снаружи используются только методы интерфейса.
 */
export type TransportMessage = unknown;

/** Роль стороны, которая использует транспорт. */
export type TransportRole = "host" | "dialog";

/**
 * Единый конфиг транспорта, который можно прокинуть в attach().
 * UI работает с этим контрактом, не зная реализацию.
 */
export type TransportConfig =
  | {
      type: "ws";
      url: string;
    }
  | {
      type: "messageChannel";
      channel?: string;
    }
  | {
      type: "webContents";
      hostId: number;
      channelToDialog?: string;
      channelFromDialog?: string;
    };

/**
 * Параметры подключения/получателя для конкретной реализации.
 */
export type TransportAttachTarget = {
  role?: TransportRole;
  target?: TransportConfig;
};

/** Функция отписки от событий. */
export type Unsubscribe = () => void;

export interface WindowTransport {
  /**
   * Инициализирует транспорт и поднимает внутренние ресурсы (каналы/порты/сервер).
   * Вызывается один раз перед отправкой или подписками.
   */
  attach(params?: TransportAttachTarget): void;

  /**
   * Готов ли транспорт к отправке сообщений.
   * Реализация сама решает, что значит "готов" (порт получен/сокет подключён/канал открыт).
   */
  isReady(): boolean;

  /**
   * Подписка на событие готовности.
   * Коллбек вызывается, когда транспорт можно использовать для отправки.
   * Возвращает функцию отписки.
   */
  onReady(cb: () => void): Unsubscribe;

  /**
   * Отправляет сообщение на "другую сторону".
   * Реализация отвечает за сериализацию/буферизацию при необходимости.
   */
  send(payload: TransportMessage): void;

  /**
   * Подписка на входящие сообщения от другой стороны.
   * Возвращает функцию отписки.
   */
  onMessage(cb: (payload: TransportMessage) => void): Unsubscribe;

  /**
   * Закрывает транспорт и освобождает ресурсы.
   * Должен быть безопасен при повторном вызове.
   */
  close(): void;

  /**
   * Возвращает актуальный TransportConfig для другой стороны.
   * Нужен для передачи диалогу (через preload) без знания реализации.
   */
  getConfig(): TransportConfig | null;
}
