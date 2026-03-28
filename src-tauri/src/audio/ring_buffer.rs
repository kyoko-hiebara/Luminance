use crossbeam_channel::{Receiver, Sender, TrySendError};

/// A simple audio buffer channel using crossbeam.
/// The producer (audio callback) sends chunks, the consumer (DSP thread) receives them.
pub struct RingBuffer {
    tx: Sender<Vec<f32>>,
    rx: Receiver<Vec<f32>>,
}

impl RingBuffer {
    /// Create a new ring buffer with the given capacity (number of chunks).
    pub fn new(capacity: usize) -> Self {
        let (tx, rx) = crossbeam_channel::bounded(capacity);
        Self { tx, rx }
    }

    /// Get a producer handle (clone-safe for audio callback).
    pub fn producer(&self) -> AudioProducer {
        AudioProducer {
            tx: self.tx.clone(),
        }
    }

    /// Get the consumer handle.
    pub fn consumer(&self) -> AudioConsumer {
        AudioConsumer {
            rx: self.rx.clone(),
        }
    }
}

#[derive(Clone)]
pub struct AudioProducer {
    tx: Sender<Vec<f32>>,
}

impl AudioProducer {
    /// Try to send audio data. Non-blocking — drops data if buffer is full.
    /// This is safe to call from the audio callback thread.
    pub fn try_send(&self, data: Vec<f32>) -> bool {
        match self.tx.try_send(data) {
            Ok(()) => true,
            Err(TrySendError::Full(_)) => false, // drop frame, don't block
            Err(TrySendError::Disconnected(_)) => false,
        }
    }
}

pub struct AudioConsumer {
    rx: Receiver<Vec<f32>>,
}

impl AudioConsumer {
    /// Try to receive audio data. Non-blocking.
    pub fn try_recv(&self) -> Option<Vec<f32>> {
        self.rx.try_recv().ok()
    }

    /// Drain all available chunks and concatenate them.
    pub fn drain(&self) -> Vec<f32> {
        let mut result = Vec::new();
        while let Some(chunk) = self.try_recv() {
            result.extend_from_slice(&chunk);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_send_receive() {
        let rb = RingBuffer::new(16);
        let producer = rb.producer();
        let consumer = rb.consumer();

        let data = vec![1.0, 2.0, 3.0];
        assert!(producer.try_send(data.clone()));

        let received = consumer.try_recv().unwrap();
        assert_eq!(received, data);
    }

    #[test]
    fn test_drain() {
        let rb = RingBuffer::new(16);
        let producer = rb.producer();
        let consumer = rb.consumer();

        producer.try_send(vec![1.0, 2.0]);
        producer.try_send(vec![3.0, 4.0]);

        let drained = consumer.drain();
        assert_eq!(drained, vec![1.0, 2.0, 3.0, 4.0]);
    }

    #[test]
    fn test_full_buffer_drops() {
        let rb = RingBuffer::new(2);
        let producer = rb.producer();

        assert!(producer.try_send(vec![1.0]));
        assert!(producer.try_send(vec![2.0]));
        // Buffer is full, should return false
        assert!(!producer.try_send(vec![3.0]));
    }
}
