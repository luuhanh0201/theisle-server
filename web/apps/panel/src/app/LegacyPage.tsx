import { Button, Card, CardBody, Hint } from '@isle/ui';

/** A page not moved to React yet: the same page in the panel before React, one click away. */
export function LegacyPage({ title, hash }: { title: string; hash: string }) {
  return (
    <Card>
      <CardBody stack>
        <Hint><b>{title}</b> chưa chuyển sang panel mới. Trang này vẫn dùng đầy đủ ở panel cũ.</Hint>
        <div><a href={`/old${hash}`}><Button variant="soft">Mở {title} ở panel cũ</Button></a></div>
      </CardBody>
    </Card>
  );
}
