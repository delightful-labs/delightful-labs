const formatter = new Intl.DateTimeFormat("en", {
  dateStyle: "long",
  timeZone: "UTC",
});
export const formatDate = (value: string): string =>
  formatter.format(new Date(value));
