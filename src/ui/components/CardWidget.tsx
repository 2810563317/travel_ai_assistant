import React from "react";
import type { CardChunk } from "../../streaming/types";
import { styles } from "../styles";

/** 结构化卡片渲染 —— 根据 cardType 路由到对应的卡片组件 */
export function CardWidget({ chunk }: { chunk: CardChunk }) {
  const { cardType, data } = chunk;

  let header = cardType;
  let body: React.ReactNode = (
    <pre style={styles.cardJson}>{JSON.stringify(data, null, 2)}</pre>
  );

  switch (cardType) {
    case "route_card":
      header = "行程路线";
      body = <RouteCardContent data={data} />;
      break;
    case "weather_card":
      header = "天气信息";
      body = <WeatherCardContent data={data} />;
      break;
    // 未知卡片类型保留默认 header + JSON dump
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>{header}</div>
      <div style={styles.cardBody}>{body}</div>
    </div>
  );
}

/** 行程路线卡片 */
function RouteCardContent({ data }: { data: Record<string, unknown> }) {
  const title = data.title as string;
  const days = data.days as
    | Array<{ day: number; label: string; activities: string[] }>
    | undefined;

  return (
    <div>
      {title && (
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 15 }}>{title}</div>
      )}
      {days?.map((day, i) => (
        <div key={i} style={styles.routeDay}>
          <div style={styles.routeDayLabel}>{day.label}</div>
          <ul style={{ margin: "2px 0", paddingLeft: 18 }}>
            {day.activities.map((act, j) => (
              <li key={j} style={{ margin: "1px 0", fontSize: 12, lineHeight: 1.6 }}>
                {act}
              </li>
            ))}
          </ul>
        </div>
      )) ?? (
        <pre style={styles.cardJson}>{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  );
}

/** 天气卡片的具体渲染 */
function WeatherCardContent({ data }: { data: Record<string, unknown> }) {
  const city = data.city as string;
  const forecast = data.forecast as
    | Array<{ date: string; condition: string; high: number; low: number }>
    | undefined;

  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 15 }}>{city}</div>
      {forecast?.map((day, i) => (
        <div key={i} style={styles.weatherRow}>
          <span style={{ minWidth: 60 }}>{day.date}</span>
          <span style={{ flex: 1, textAlign: "center" }}>{day.condition}</span>
          <span style={{ minWidth: 100, textAlign: "right" }}>
            {day.low}°C ~ {day.high}°C
          </span>
        </div>
      )) ?? <pre style={styles.cardJson}>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
