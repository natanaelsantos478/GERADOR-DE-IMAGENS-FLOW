"""RoadNet: a small U-Net for road-marking segmentation, built only from layers that map to simple GPU compute
shaders (3x3 depthwise conv, 1x1 conv, batch-norm folded into the convs, ReLU, 2x2 max-pool, nearest upsample,
concatenation). ~0.3 M parameters: ~1.2 MB in float32, ~0.3 MB in INT8, light enough for a phone.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F


class DSConv(nn.Module):
    """Depthwise 3x3 (optionally dilated) + pointwise 1x1, each with BN and ReLU."""
    def __init__(self, cin, cout, dil=1):
        super().__init__()
        self.dw = nn.Conv2d(cin, cin, 3, padding=dil, dilation=dil, groups=cin, bias=False)
        self.bn1 = nn.BatchNorm2d(cin)
        self.pw = nn.Conv2d(cin, cout, 1, bias=False)
        self.bn2 = nn.BatchNorm2d(cout)

    def forward(self, x):
        x = F.relu(self.bn1(self.dw(x)))
        return F.relu(self.bn2(self.pw(x)))


class Block(nn.Module):
    def __init__(self, cin, cout, dil=1):
        super().__init__()
        self.a = DSConv(cin, cout)
        self.b = DSConv(cout, cout, dil)

    def forward(self, x):
        return self.b(self.a(x))


class RoadNet(nn.Module):
    def __init__(self, classes=10, w=(24, 48, 64, 96, 128)):
        super().__init__()
        self.stem = nn.Sequential(nn.Conv2d(3, w[0], 3, padding=1, bias=False), nn.BatchNorm2d(w[0]), nn.ReLU())
        self.e1 = Block(w[0], w[0])
        self.e2 = Block(w[0], w[1])
        self.e3 = Block(w[1], w[2])
        self.e4 = Block(w[2], w[3])
        # bottleneck with dilation: long receptive field along the road (dash period, zebra extent)
        self.mid = nn.Sequential(Block(w[3], w[4], 2), Block(w[4], w[4], 4))
        self.d4 = Block(w[4] + w[3], w[3])
        self.d3 = Block(w[3] + w[2], w[2])
        self.d2 = Block(w[2] + w[1], w[1])
        self.d1 = Block(w[1] + w[0], w[0])
        self.head = nn.Conv2d(w[0], classes, 1)

    def forward(self, x):
        x = self.stem(x)
        s1 = self.e1(x)                       # 1
        s2 = self.e2(F.max_pool2d(s1, 2))     # 1/2
        s3 = self.e3(F.max_pool2d(s2, 2))     # 1/4
        s4 = self.e4(F.max_pool2d(s3, 2))     # 1/8
        m = self.mid(F.max_pool2d(s4, 2))     # 1/16
        up = lambda t, ref: F.interpolate(t, size=ref.shape[-2:], mode='nearest')
        y = self.d4(torch.cat([up(m, s4), s4], 1))
        y = self.d3(torch.cat([up(y, s3), s3], 1))
        y = self.d2(torch.cat([up(y, s2), s2], 1))
        y = self.d1(torch.cat([up(y, s1), s1], 1))
        return self.head(y)


if __name__ == '__main__':
    m = RoadNet()
    n = sum(p.numel() for p in m.parameters())
    print('params', n, 'float32 MB %.2f' % (n * 4 / 1e6))
    print(m(torch.zeros(1, 3, 256, 160)).shape)
